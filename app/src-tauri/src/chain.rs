//! Helios light clients, one for each supported chain. They start with the
//! app. The webview reads verified chain state through the two commands.

use std::collections::HashMap;
use std::path::Path;

use alloy::eips::BlockId;
use alloy::primitives::{Address, B256};
use alloy::rpc::types::SyncStatus;
use helios_ethereum::config::networks::Network;
use helios_ethereum::database::FileDB;
use helios_ethereum::{EthereumClient, EthereumClientBuilder};
use serde::Serialize;
use serde_json::{Value, json};
use tauri::State;

struct Chain {
    id: u64,
    name: &'static str,
    network: Network,
    /// A beacon node with the light client API.
    consensus_rpc: &'static str,
    /// An execution node with `eth_getProof`.
    execution_rpc: &'static str,
}

const CHAINS: [Chain; 2] = [
    Chain {
        id: 1,
        name: "mainnet",
        network: Network::Mainnet,
        consensus_rpc: "https://ethereum-beacon-api.publicnode.com",
        execution_rpc: "https://ethereum-rpc.publicnode.com",
    },
    Chain {
        id: 11155111,
        name: "sepolia",
        network: Network::Sepolia,
        consensus_rpc: "https://ethereum-sepolia-beacon-api.publicnode.com",
        execution_rpc: "https://ethereum-sepolia-rpc.publicnode.com",
    },
];

/// The client of each chain, or the reason why it did not start.
pub struct Chains(HashMap<u64, Result<EthereumClient, String>>);

impl Chains {
    /// Call it inside the async runtime: Helios starts its sync tasks there.
    pub fn start(data_dir: &Path) -> Self {
        Self(
            CHAINS
                .iter()
                .map(|chain| (chain.id, start(chain, data_dir)))
                .collect(),
        )
    }

    fn client(&self, chain_id: u64) -> Result<&EthereumClient, String> {
        match self.0.get(&chain_id) {
            Some(Ok(client)) => Ok(client),
            Some(Err(err)) => Err(format!("Helios did not start: {err}")),
            None => Err(format!("chain {chain_id} is not supported")),
        }
    }
}

fn start(chain: &Chain, data_dir: &Path) -> Result<EthereumClient, String> {
    let build = || {
        EthereumClientBuilder::<FileDB>::new()
            .network(chain.network)
            .consensus_rpc(chain.consensus_rpc)?
            .execution_rpc(chain.execution_rpc)?
            // If the saved checkpoint is too old, take the checkpoint that
            // most public checkpoint services agree on.
            .load_external_fallback()
            // Helios saves its newest checkpoint here.
            .data_dir(data_dir.join(chain.name))
            .build()
    };
    build().map_err(|err| err.to_string())
}

#[derive(Serialize)]
pub struct Ready {
    /// The newest verified block.
    block: u64,
    /// The newest finalized checkpoint.
    checkpoint: Option<B256>,
}

/// Waits until Helios is synced and its head is recent.
#[tauri::command]
pub async fn chain_ready(chains: State<'_, Chains>, chain_id: u64) -> Result<Ready, String> {
    let client = chains.client(chain_id)?;
    client.wait_synced().await.map_err(|err| err.to_string())?;
    if !matches!(client.syncing().await, Ok(SyncStatus::None)) {
        return Err("Helios is behind the chain head".into());
    }
    let head = client
        .get_block_number()
        .await
        .map_err(|err| err.to_string())?;
    let checkpoint = client
        .current_checkpoint()
        .await
        .map_err(|err| err.to_string())?;
    Ok(Ready {
        block: u64::try_from(head).map_err(|err| err.to_string())?,
        checkpoint,
    })
}

/// Answers an EIP-1193 request with verified state. It supports only the
/// methods below.
#[tauri::command]
pub async fn chain_request(
    chains: State<'_, Chains>,
    chain_id: u64,
    method: String,
    params: Value,
) -> Result<Value, String> {
    let client = chains.client(chain_id)?;
    match method.as_str() {
        "eth_getCode" => {
            let (address, block): (Address, BlockId) =
                serde_json::from_value(params).map_err(|err| err.to_string())?;
            let code = client
                .get_code(address, block)
                .await
                .map_err(|err| err.to_string())?;
            Ok(json!(code))
        }
        _ => Err(format!("{method} is not supported")),
    }
}

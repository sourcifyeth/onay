//! Helios light clients, one for each chain in Helios mode. The webview
//! owns the list of chains: it starts and stops the clients, and reads
//! verified chain state through the commands.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use alloy::eips::BlockId;
use alloy::primitives::{Address, B256};
use alloy::rpc::types::SyncStatus;
use helios_ethereum::config::networks::Network;
use helios_ethereum::database::FileDB;
use helios_ethereum::{EthereumClient, EthereumClientBuilder};
use serde::Serialize;
use serde_json::{Value, json};
use tauri::State;

/// The running clients, by chain id.
pub struct Chains {
    clients: Mutex<HashMap<u64, Arc<EthereumClient>>>,
    /// Helios saves the newest checkpoint of each chain here.
    data_dir: PathBuf,
}

impl Chains {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            clients: Mutex::default(),
            data_dir,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<u64, Arc<EthereumClient>>> {
        // A panic in another thread must not stop the chains. Same as link.rs.
        self.clients
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn client(&self, chain_id: u64) -> Result<Arc<EthereumClient>, String> {
        let clients = self.lock();
        let client = clients.get(&chain_id).cloned();
        client.ok_or_else(|| format!("Helios does not run for chain {chain_id}"))
    }

    fn replace(
        &self,
        chain_id: u64,
        client: Option<EthereumClient>,
    ) -> Option<Arc<EthereumClient>> {
        let mut clients = self.lock();
        match client {
            Some(client) => clients.insert(chain_id, Arc::new(client)),
            None => clients.remove(&chain_id),
        }
    }
}

/// Starts the client of a chain. A client that runs for the chain stops.
#[tauri::command]
pub async fn start_chain(
    chains: State<'_, Chains>,
    chain_id: u64,
    consensus_rpc: String,
    execution_rpc: String,
) -> Result<(), String> {
    let build = || {
        EthereumClientBuilder::<FileDB>::new()
            .network(Network::from_chain_id(chain_id)?)
            .consensus_rpc(consensus_rpc.as_str())?
            .execution_rpc(execution_rpc.as_str())?
            // If the saved checkpoint is too old, take the checkpoint that
            // most public checkpoint services agree on.
            .load_external_fallback()
            .data_dir(chains.data_dir.join(chain_id.to_string()))
            .build()
    };
    let client = build().map_err(|err| err.to_string())?;
    if let Some(old) = chains.replace(chain_id, Some(client)) {
        old.shutdown().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn stop_chain(chains: State<'_, Chains>, chain_id: u64) -> Result<(), String> {
    if let Some(old) = chains.replace(chain_id, None) {
        old.shutdown().await;
    }
    Ok(())
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

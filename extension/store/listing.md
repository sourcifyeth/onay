# Chrome Web Store listing

The texts in the developer dashboard, kept here so that a change to the listing is reviewed like code. The publisher is `sourcify.eth`, the item ID is the extension ID.

## Store listing

**Title:** Onay

**Summary:** Sends each signing request to the local Onay app for a second, independent check before your wallet signs.

**Description:**

Onay is a local signing companion. It gives every transaction a second, independent check before your wallet signs it.

This extension is the thin browser part. It watches the wallet provider on each page and, when a dapp asks the wallet to sign (a transaction, a message, or typed data), sends a copy of the request to the Onay desktop app on the same computer. The wallet receives the request unchanged and at the same time. The extension never holds keys, never changes a request, and never blocks the wallet.

The app does the work: it reads the contract code as verified chain state, checks the source code against Sourcify, decodes the call, simulates it, and shows you what you are about to sign. You compare the digest with what your wallet shows and decide.

You need the Onay app for this extension to do anything. Get it at https://sourcify.dev.

Onay is free software (GPL-3.0) by the Sourcify team.

**Category:** Privacy & Security

**Language:** English

**Official URL / Homepage URL:** https://sourcify.dev

**Support URL:** https://github.com/sourcifyeth/onay/issues (private until the repo is public: use the Sourcify contact page instead)

**Screenshots (1280x800, one to five):** `store-screenshot-1.png` and `store-screenshot-2.png` in this folder, taken from the mock. The store icon is `icon-128.png` (source `nazar.svg`).

## Privacy tab

**Single purpose:**

Onay sends a copy of each signing request that a web page makes to the user's wallet (eth_sendTransaction, eth_signTypedData, personal_sign and the related methods) to the Onay desktop app on the same computer, so that the user can check the request independently before the wallet signs. The extension never holds keys, never changes a request, and sends nothing over the network.

**Permission justification, nativeMessaging:**

The extension talks to the Onay desktop app through the native messaging host dev.sourcify.onay. This is its only way out of the browser. Each signing request is sent to the app over this channel, encrypted end to end, and the app's answer (its status, the pairing code) comes back the same way. The extension makes no network requests.

**Host permission justification (content scripts on http://_/_ and https://_/_):**

A dapp can run on any website, and the wallet provider (window.ethereum, EIP-6963) is injected into every page. To see a signing request, the content script must run on the page that makes it, before the page's own scripts. It only watches the wallet's request methods and reports signing requests; every other call passes through untouched. It does not read, collect, or change page content, and it does not track which pages the user visits.

**Remote code:** No, I am not using remote code. (Justification, if the form asks for one: All code is in the package. The extension loads no scripts, modules, or eval'd strings from the network.)

**Data usage, data types the extension handles:**

- Website content: the signing request that the page makes to the wallet (addresses, amounts, calldata, the message to sign) and the origin of that page. It is handled only to show it to the user in the Onay app on the same computer. It is not stored by the extension and never leaves the computer.
- Financial and payment information: a transaction request contains amounts and account addresses. Same handling as above.

Everything else unticked. No personally identifiable information, no authentication information, no health, location, personal communications, user activity, or web history.

**Certifications, tick all three:**

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://sourcifyeth.github.io/onay/privacy.html

## Distribution tab

Free. Visibility: Unlisted until the app is released, then Public. All regions.

## Privacy policy

The page is `mock/public/privacy.html`, published with the mock at https://sourcifyeth.github.io/onay/privacy.html on every push to main. Edit the page and the date at its bottom together.

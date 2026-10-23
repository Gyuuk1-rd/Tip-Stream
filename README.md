# TipStream — Creator tips in XLM, split for good

A creator tipping app where **fans tip in testnet XLM** through a
[Paiflow](https://beta.app.paiflow.xyz) `Receive → Split` deployment. Every tip is
split automatically:

- **90% → the creator**
- **10% → the creator's chosen charity**

No manual math, no trust required — the smart contract splits each tip and the
app marks a tip **received** only after both payouts are verified on-chain.

> Runs on the **Stellar testnet**. Testnet XLM is free (from a faucet) and has
> no real value. Never point this walkthrough at mainnet.

---

## What it does

- **Tips** — each tip is a supporter + an amount (XLM) + a short message. The
  message shows in the tip list, the View modal and the payment review.
- **Supporters** — name plus an optional note; feeds the tip form's dropdown.
- **Pay with XLM** — Freighter signs the exact prepared XDR; the server
  verifies the signed body hash before submitting; a tip flips to *received*
  only when the receipt **and** both payout events match (amounts ±1 stroop).
- **Check payment** — recovery by original transaction hash. Wi-Fi dropped?
  Server restarted? Never re-pay blindly — check, and the original payment is
  confirmed, never duplicated.
- **Impact dashboard** — cumulative XLM per recipient, straight from the
  testnet ledger, with milestone bars. Updates every 10s.
- **Activity feed** — every tip with its transaction link, split amounts and
  time-ago.
- **AI presenter** — `POST /api/ask` answers any question (used by the voice
  deck, `presentation.html`).
- **Presentation** — `presentation.html`: a 12-slide voice-driven deck with
  manual slide control, spoken narration, microphone commands
  ("next slide", "go to slide 3", "repeat that", "stop listening") and
  ask-anything Q&A.

## Tech stack

| Layer   | Tech |
|---------|------|
| Server  | Node 22 · Express · `@paiflow/sdk` · `@stellar/stellar-sdk` |
| Browser | Vanilla JS · vendored `@stellar/freighter-api` · no build step |
| Chain   | Stellar **testnet** · Soroban contract (via Paiflow) |
| Data    | `localStorage` (tips/supporters UI) · `orders.json` (payment records) |

## How to run

```bash
npm install   # only if node_modules is missing
npm start
```

Then open **http://localhost:3001**.

The server needs a reachable Paiflow deployment (see `.env` below) — it binds
the deployment at boot and refuses to start without it.

## How to demo (90-second script)

1. **Open the app** at http://localhost:3001 — point at the flow diagram:
   *fan tips → contract → 90% creator / 10% charity*.
2. **Add a supporter** — name `ana`, note `day-one fan`.
3. **Create a tip** — supporter *ana*, amount **20**, message
   *"love the stream!"*. It appears as tip **#1**, status **open**.
4. **View it** — the modal shows the message and the split: 18 XLM creator +
   2 XLM charity, with both public addresses.
5. **Tip with XLM** — click *Tip with XLM*. Freighter opens (unlock it,
   approve the `http://localhost:3001` origin, make sure it is on **Stellar
   Testnet**). Review the exact amounts, approve, sign.
6. **Watch it verify** — the modal polls the ledger; when both payouts are
   confirmed the tip flips to **received** automatically and shows the
   transaction link.
7. **Show the money** — scroll to *Follow the money*: creator and charity
   totals grew by exactly 18 and 2. The activity feed shows tip #1 with its
   tx hash.
8. **(Optional) Present** — open `/presentation.html`, press **Voice: ON**,
   click the slide, and let the built-in AI answer audience questions by
   voice ("what is a stroop?").

If a payment ever looks stuck: **Check payment** — it confirms the original
transaction and never creates a second one.

## Environment variables (`.env`)

| Variable | Meaning |
|----------|---------|
| `PAIFLOW_BASE_URL` | Paiflow API base URL (`https://beta.app.paiflow.xyz`) |
| `PAIFLOW_DEPLOYMENT_ID` | Your `Receive → Split` deployment UUID |
| `PAIFLOW_API_TOKEN` | Developer API token — **server-side only**, never in the browser |
| `FREELANCER_ADDRESS` | The 90% recipient = the **creator** in TipStream (name kept to match the deployment config) |
| `COMMUNITY_ADDRESS` | The 10% recipient = the **charity** |
| `PORT` | Server port — **3001** |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | Optional: a smarter AI for `/api/ask` (any OpenAI-compatible endpoint). Without it, a free no-key fallback is used (1 reply / 30s per IP). |

Copy `.env.example` to `.env` and fill in your own values to re-point the app
at a different deployment.

## Sharing over the internet (cloudflared)

Freighter needs an `https` or `localhost` origin, so to demo from another
machine tunnel the local server:

```bash
cloudflared tunnel --url http://localhost:3001
```

Cloudflare prints a `https://…trycloudflare.com` URL. Open **that** URL for
the demo (the AI answer endpoint needs the server running; the page itself
still requires `npm start`). Unlock Freighter and approve the tunnel origin
when it prompts.

## Safety design (kept from the payment walkthrough)

- **Idempotent prepare** — repeating a payment request returns the *same*
  preparation, so a double click can never become a double charge.
- **Original-envelope verification** — the server compares the body hash of
  the wallet-signed XDR against the prepared one; tampered bodies and
  fee-bump wrappers are rejected before submission.
- **Payout evidence** — a receipt `SUCCESS` alone is not enough; the app
  checks the RECEIVE amount and both PAYOUT recipients (bps + amount ±1
  stroop) before marking a tip received.
- **No silent retries** — expired preparations, failed transactions and
  missing events keep their records and wait for a human decision.
- **Hash-based recovery** — even if the server's tip store is lost, "Check
  payment" re-verifies by the original transaction hash kept in the browser.

## Honest limits

- `orders.json` is a JSON-file stand-in for a database — fine for a demo, not
  for production.
- No authentication on the checkout routes; add it before exposing beyond a
  demo.
- `/api/debug/*` endpoints are temporary debugging aids — remove before any
  real deployment.
- Mainnet would require a proper security audit. Testnet only for now.

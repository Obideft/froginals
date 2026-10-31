# FROGINALARMY NFT-gated membership portal

This project adds server-side Solana NFT verification and a shared Supabase member directory while retaining the FROGINALS header/banner, Brand Film, GraveMarket listings, and Trash Can Treasure mission.

## Files

- `froginalarmy.html` — responsive orange/yellow/black membership page.
- `api/verify-froginal-holder.js` — POST endpoint that validates the wallet, queries Helius DAS `getAssetsByOwner`, requires the matching **verified** collection grouping, and only then upserts an approved record.
- `api/froginalarmy-members.js` — public GET endpoint returning only sanitized approved records.
- `supabase.sql` — membership table, constraints, index, and restrictive RLS setup.
- `.env.example` — variable names only; contains no real secrets.

## Important collection verification prerequisite

The supplied collection address is configured as `FROGINAL_COLLECTION_ADDRESS`. The verifier requires a DAS asset to contain a `grouping` entry where `group_key === "collection"`, `group_value` exactly equals this configured address, and `verified === true`. It also requires the asset's current `ownership.owner` to equal the submitted wallet and `burnt !== true`. It does not trust names, images, creators alone, or Gravemarket listing data.

**Before enabling public production signups, test a known real FROGINAL DOGS mint with Helius DAS and confirm that the returned collection `group_value` is exactly `DEADY34TucemEebp6PJwmggAGDUmpSMoS4CcESKNBPRh` and that the grouping has `verified: true`.** I cannot inspect a private-key-backed Helius response from this package, so this must be verified against your live project. If the collection field differs or the verified flag is absent, this code fails closed (does not approve) until the collection identity rule is corrected using a real DAS response.

## Deploy to Vercel

1. Back up the current GitHub repository and inspect its existing `package.json`, `vercel.json`, and `api/` directory. Copy these files into the existing repository; do not replace unrelated APIs.
2. Keep `froginalarmy.html` at the repository root if that is where your current live page is served. Keep all existing assets and routes.
3. In Supabase SQL Editor, run `supabase.sql`. If you already created a table with this name, inspect its schema first and reconcile the columns rather than blindly assuming it matches.
4. In Vercel → Project → Settings → Environment Variables, add `HELIUS_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Add `FROGINAL_COLLECTION_ADDRESS` explicitly after confirming the collection group value. Apply to Preview and Production as appropriate, then redeploy.
5. Use the Supabase **service-role secret key** only as `SUPABASE_SERVICE_ROLE_KEY` on the server. Never use a publishable/anon key for this variable. Never put Helius or Supabase secret keys in HTML, client JavaScript, Git, or chat.
6. Confirm `/api/verify-froginal-holder` and `/api/froginalarmy-members` deploy as Vercel Node serverless functions. Existing `/api/create-order` and `/api/printful-variants` files must remain untouched.

No `package.json` is required by these two endpoints because they use Node's built-in APIs and `fetch`. If your repository already has one, preserve it.

## Membership freshness and transfer policy

The verification endpoint checks current ownership whenever a wallet verifies and updates `last_checked_at`. This starter does not automatically remove members who sell or transfer their NFT later. To keep membership accurate, add a scheduled revalidation job (for example Vercel Cron) that rechecks every approved wallet and flips `approved` to false when the verified NFT is no longer owned. Until that is deployed, treat the directory as holders who were verified at their most recent successful check, not a guarantee of perpetual current ownership. A future hardening pass should also add a shared rate limiter (the included in-memory throttle is only per serverless instance) and a scheduled stale-member policy.

## Discord holder-role verification

The Discord verification flow is separate from the public member directory form. It uses Discord OAuth, a short-lived signed session cookie, a one-time Phantom message signature, a server-side Helius DAS ownership check, and the Discord REST API to assign the configured holder role. It never requests a seed phrase or private key.

### Required setup

1. In Supabase SQL Editor, run `supabase-discord-links.sql`. This creates a separate private table for Discord-to-wallet links; it does not replace `froginalarmy_members`.
2. In Discord Developer Portal, open your bot application → OAuth2 and note the **Client ID** and create/copy the **Client Secret**. Add the exact redirect URL `https://froginals-nu.vercel.app/api/discord-callback` to the OAuth2 Redirects list.
3. In Vercel → Project → Settings → Environment Variables, add `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_HOLDER_ROLE_ID`, and `DISCORD_SESSION_SECRET`. Use the same redirect URL above. Generate a random `DISCORD_SESSION_SECRET` with at least 32 characters. Apply the variables to Production (and Preview if needed), then redeploy.
4. Keep `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_SESSION_SECRET`, `HELIUS_API_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` server-side only. Never put them in HTML or commit real values.
5. Confirm the bot is in the FROGINALS Discord server, has **Manage Roles**, and its highest role is above `🐸 FROGINAL HOLDER`. The visitor must join the server before role assignment can work.
6. Verify that `FROGINAL_COLLECTION_ADDRESS` exactly matches the verified collection group value returned by Helius DAS.

### Discord verification endpoints

- `GET /api/discord-start` — begins Discord OAuth.
- `GET /api/discord-callback` — validates OAuth state and creates a short-lived HttpOnly session.
- `GET /api/discord-status` — reports the current session and linked verification status.
- `POST /api/discord-challenge` — issues a five-minute wallet-specific signing challenge.
- `POST /api/verify-discord-holder` — verifies the Ed25519 wallet signature, checks live NFT ownership, saves the unique link, and assigns the holder role.
- `POST /api/discord-logout` — clears the browser session.

A wallet and Discord account can each be linked to only one record. If an existing link needs changing, have an administrator review it rather than deleting database rows blindly. The role grant is an idempotent Discord API call; if the NFT check passes but role assignment fails, check server membership, bot permissions, and role hierarchy, then retry.

## Manual verification checklist

Do not mark these as passed until tested against your Vercel deployment:

1. **Known holder:** submit a wallet known to own a FROGINAL DOGS NFT; expect HTTP 200 and an approved directory record only if Helius returns the exact verified collection grouping.
2. **Non-holder:** submit a valid wallet with no qualifying NFT; expect HTTP 403 and no row inserted.
3. **Malformed address:** submit invalid base58 / wrong-length text; expect HTTP 400 and no Helius approval.
4. **Helius/Supabase failure:** temporarily use an invalid test key in Preview; expect a failure response and no new approved record.
5. **Public directory:** call `GET /api/froginalarmy-members`; only approved rows should appear. Confirm unauthenticated direct Supabase writes are denied.
6. **Metadata:** compare the selected mint, name, and image to the matching Helius DAS asset. Images are only accepted as HTTPS URLs from the DAS content fields.
7. **Existing features:** check the Brand Film iframe, live Gravemarket feed/refresh, Trash Can Treasure game link, and X intent draft.
8. **Existing integrations:** test `/api/create-order` and `/api/printful-variants` after deployment.

## Notes

- The wallet address is public information. Visitors are never asked for a seed phrase, private key, or transaction signature.
- The directory endpoint returns at most 500 approved rows per request in this starter. Add cursor pagination if the membership directory grows beyond that.
- The in-memory rate limiter is a basic guard only; serverless instances do not share its state.
- The public directory includes public wallet addresses by design. Tell members that their wallet address and NFT metadata will be publicly displayed before they join.


## Post-mint FROGINAL DOGS welcome email

The new `welcome.html` page lets a Solana holder connect Phantom, sign a short-lived message, and submit an email address. `api/welcome.js` verifies the signature and checks current ownership of the verified FROGINAL DOGS collection through the existing Helius DAS helper before recording the claim and sending the welcome email through Resend.

### Required setup before public use

1. In Supabase SQL Editor, run `supabase-welcome-emails.sql`. This creates a separate private table and does not modify the existing membership tables.
2. In Vercel → Project → Settings → Environment Variables, add:
   - `RESEND_API_KEY` — server-only Resend API key.
   - `WELCOME_SESSION_SECRET` — random secret of at least 32 characters, used to sign the short-lived wallet challenge cookie.
   - `WELCOME_FROM_EMAIL` — a sender address verified in your Resend account, e.g. `FROGINALS <welcome@your-verified-domain>`.
   - `FROGINALS_DISCORD_INVITE` — a current invite URL for the FROGINALS Discord server.
3. The existing `HELIUS_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are also required. The collection address defaults to `DEADY34TucemEebp6PJwmggAGDUmpSMoS4CcESKNBPRh`, but confirm it matches the verified collection grouping returned by Helius before launch.
4. Redeploy Vercel after setting variables.

### Test checklist

- Open `/welcome.html`, connect a Phantom wallet holding a known official FROGINAL DOG, and sign the verification message.
- Submit an email and confirm the email arrives with the Discord and OG Rewards links.
- Test a wallet with no qualifying NFT; it must be rejected and must not create a welcome claim.
- Test a different email against the same NFT; the system must not send a second welcome email for that NFT.
- Check Resend delivery logs and Supabase claim status.

The welcome flow is separate from GraveMint checkout: it does not receive a buyer email from GraveMint or rely on a GraveMint webhook. Buyers visit the welcome page after minting and prove current wallet ownership themselves. Robinhood Chain holders remain on the existing manual team-verification path.

**Not live until configured:** the GitHub changes can deploy automatically through Vercel, but email sending will return a configuration error until the SQL migration and Resend/Vercel environment variables above are completed. Never commit API keys or service-role secrets.


## Dual-chain Discord holder welcome flow

The existing Discord OAuth and role-assignment flow now supports either:
- **Solana:** the existing short-lived Phantom message signature and verified Helius DAS collection ownership check.
- **Robinhood Chain:** EIP-191 message signature plus a read-only ERC-721 `balanceOf(address)` check on chain ID `4663`, against the configured FROGINAL DOGS collection contract.

Both paths grant the same configured `DISCORD_HOLDER_ROLE_ID` and attempt a first-time Discord DM. The DM points holders to `#mission-briefing`, the FROGINALS community mission, and the OG Rewards dashboard. A private `froginalarmy_discord_welcomes` table prevents repeat welcomes. This is a DM workflow using the Discord REST API; it does not require a permanently running Gateway bot or privileged Gateway intents.

### New setup before enabling

1. Run `supabase/migrations/20261031100000_add_dual_chain_discord_welcome.sql` in Supabase SQL Editor. It adds the chain fields and private welcome-delivery status table.
2. In Vercel Production and Preview as appropriate, configure:
   - `FROGINAL_EVM_NFT_CONTRACT_ADDRESS=0x646C988463aa175956F59CC1f9Efa137CD0A9d7b`
   - `ROBINHOOD_RPC_URL` — a production RPC endpoint for Robinhood Chain mainnet (chain ID 4663); Alchemy is recommended. Do not rely on the public RPC for production traffic.
   - `DISCORD_MISSION_BRIEFING_CHANNEL_ID` — the Discord channel ID for the actual `#mission-briefing` channel, so the welcome DM can include a clickable deep link.
3. Confirm `DISCORD_HOLDER_ROLE_ID` is the shared `🐸 FROGINAL HOLDER` role and the bot has Manage Roles with its highest role above the holder role.
4. The holder must already be a member of the Discord guild. The bot creates a DM channel and sends the welcome after successful role assignment. No Gateway listener or Message Content intent is needed.
5. Test the EVM signature and contract balance read on a known holder wallet before enabling the mainnet UI. The ownership check is read-only; it never requests a transaction signature or wallet secret.

### Important eligibility boundary

This Discord role is for **at least one FROGINAL DOGS NFT** on either supported chain. It is not the OG Rewards completion check. The 50 Recruitment Badge designs remain a separate collection/progress requirement and must be evaluated by the OG Rewards eligibility system, not by this holder-role verifier.

### Welcome delivery behavior

Welcome delivery is best-effort after the role is granted. A failed DM does not revoke the role or mark ownership invalid. Delivery state is stored as `pending`, `sent`, or `failed`; a later successful verification can retry a failed welcome, while a sent welcome is never sent again automatically. A pending delivery is not retried automatically to avoid duplicate DMs if Discord accepted a message but the network response was lost.

# MassApp – WhatsApp campaign launcher

![MassApp cover](public/readme-cover.svg)

[![Version](https://img.shields.io/badge/version-4.0.0-6366f1.svg?style=for-the-badge)](package.json) [![Build Tool](https://img.shields.io/badge/build%20tool-Vite-646cff.svg?style=for-the-badge&logo=vite&logoColor=white)](vite.config.js) [![License](https://img.shields.io/badge/license-MIT-0ea5e9.svg?style=for-the-badge)](LICENSE)

MassApp is a Vite + React PWA for launching WhatsApp outreach. Paste your list, write the message once, and open chats in bulk.

## Features

- Cleans phone numbers and builds ready-to-send WhatsApp links.
- Supports WhatsApp Web, api.whatsapp.com, and template modes.
- Imports and flags contacts via Supabase with health metrics.
- Saves reusable message templates and personal details.
- Offers optional AI suggestions to personalize copy per contact.

## Requirements

- Node.js 18+ (or Bun 1.1+).
- Browser already logged into WhatsApp Web with pop-ups allowed.

## Quick Start

```bash
bun install         # npm / pnpm / yarn also works
bun run dev         # http://localhost:5174
```

Build and preview production:

```bash
bun run build
bun run preview
```

## Launching Campaigns

1. Open the app in the browser that has WhatsApp Web active.
2. Paste one phone number per line; formatting is auto-normalized.
3. Draft the message body and pick the delivery mode.
4. Click **Open WhatsApp Tabs** and approve the pop-up batch if prompted.
5. Use the preview list as a fallback whenever the browser blocks pop-ups.

## BrowserOS Workflow (Optional)

The optional BrowserOS companion keeps MassApp in sync while you handle the WhatsApp tab.

1. Single-click a **Pending** contact to auto-fill the launcher.
2. Launch the WhatsApp tab, send the message, then close the tab.
3. Double-click the same contact to mark it **Sent** and expose the next pending row.
4. If anything stalls, enable pop-ups, verify the Pending filter, and let WhatsApp finish loading before sending.

## Configuration

1. Copy the sample environment file:

   ```bash
   cp .env.development .env.local
   ```

   | Variable | Description |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Supabase project REST endpoint |
   | `VITE_SUPABASE_ANON_KEY` | Public anonymous key for client SDK calls |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service role key used only by server utilities |
   | `SUPABASE_DB_PASSWORD` | Optional helper for local Postgres access |
   | `VITE_ZAI_API_KEY` | Z AI chat API key (store locally, never commit) |
   | `VITE_ZAI_CHAT_URL` | Optional override for the chat completion endpoint |
   | `VITE_ZAI_MODEL` | Optional model alias (default `GLM-4.7-Flash`) |

2. Run the SQL in [supabase/schema.sql](supabase/schema.sql) on a fresh Supabase project.
3. Provision a Supabase Auth user account for MassApp sign-in.
4. Update icons or manifest assets in `public/` as needed.

## AI Personalization (Optional)

1. Add credentials to `.env.local`:

   ```bash
   echo "VITE_ZAI_API_KEY=your-zai-key-here.your-zai-secret" >> .env.local
   ```

   Override `VITE_ZAI_CHAT_URL` or `VITE_ZAI_MODEL` if your deployment differs.

2. Restart the dev server so the environment variables load.
3. Select contacts, prepare a template or custom text, and click the ⚡ button above the composer.
4. Review the suggestion and Apply to replace the current draft.

No AI content is stored unless you accept it.

## Project Structure

```
.
├── public/            # Static assets and manifest
├── src/
│   ├── App.jsx        # Launcher UI and core logic
│   ├── components/    # UI building blocks
│   ├── lib/           # Supabase + AI helpers
│   └── main.jsx       # App entry point
├── package.json       # Scripts and dependencies
├── tailwind.config.js # Tailwind configuration
├── vite.config.js     # Vite + PWA setup
└── supabase/          # Database schema
```

## Limitations

- WhatsApp still requires manual confirmation; unattended sending is unsupported.
- Browsers may block pop-ups; open links from the preview list when that happens.
- Scheduling and delivery analytics are out of scope to keep the tool lightweight.

## License

Released under the [MIT License](LICENSE).

## 🧠 Acknowledgments

"Whoever loves discipline loves knowledge, but whoever hates correction is stupid."
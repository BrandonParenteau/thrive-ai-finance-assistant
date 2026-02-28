# Thrive - Canadian Personal Finance App

## Overview

Thrive is a Canadian-focused personal finance mobile app built with React Native (Expo). It helps users track accounts, analyze spending, manage budgets, and get AI-powered financial advice tailored to Canadian financial products (TFSA, RRSP, FHSA, RESP, CPP, etc.).

The app has four main screens:
- **Overview** – Net worth dashboard with account summaries
- **Accounts** – Manage bank/investment accounts (TD, RBC, Wealthsimple, etc.)
- **Insights** – Budget tracking and spending breakdowns by category
- **Assistant** – AI chat powered by OpenAI (streaming responses, Canadian finance context)

The backend is an Express.js server that proxies OpenAI requests and serves the Expo web bundle in production.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend (React Native / Expo)

- **Framework**: Expo SDK 54 with Expo Router (file-based navigation)
- **Navigation**: Tab-based layout using `expo-router`'s `Tabs` component. On iOS with Liquid Glass available, it uses `NativeTabs` for a native feel; otherwise falls back to a custom `BlurView`-backed tab bar
- **State Management**: 
  - `FinanceContext` (React Context + AsyncStorage) stores all local finance data — accounts, transactions, and budgets. This is persisted locally on the device using AsyncStorage.
  - `@tanstack/react-query` is used for server-side data fetching (API calls to the Express backend)
- **Styling**: Dark-only theme with a green/mint palette defined in `constants/colors.ts`. No light mode.
- **Fonts**: DM Sans (Google Fonts via `@expo-google-fonts/dm-sans`)
- **Animations**: `react-native-reanimated` for smooth UI interactions
- **AI Chat**: Streaming SSE response from `/api/chat` endpoint, rendered token-by-token in the assistant screen

### Backend (Express.js)

- **Server**: Express 5 running as a Node.js process (`server/index.ts`)
- **API Routes**: Defined in `server/routes.ts`:
  - `POST /api/chat` — Streams OpenAI chat completions using SSE
- **CORS**: Configured to allow Replit dev/deployment domains and localhost
- **Production**: Serves a static Expo web bundle via the landing page template

### Data Storage

- **Local (primary)**: AsyncStorage on the device stores all finance data (accounts, transactions, budgets). This is the main data layer — no server-side persistence for finance data yet.
- **Database (PostgreSQL via Drizzle ORM)**: 
  - Schema defined in `shared/schema.ts` (users table) and `shared/models/chat.ts` (conversations + messages tables)
  - Database is used for chat conversation history and user accounts
  - `drizzle-kit` used for schema migrations (`db:push` command)
  - Connection via `DATABASE_URL` environment variable

### Replit Integration Modules

The `server/replit_integrations/` folder contains reusable AI service modules:
- **chat**: Conversation/message storage + OpenAI streaming chat routes
- **audio**: Speech-to-text, text-to-speech, voice chat via OpenAI + ffmpeg
- **image**: Image generation/editing via OpenAI `gpt-image-1`
- **batch**: Rate-limited batch processing with retry logic using `p-limit` and `p-retry`

These are pre-built integration patterns and may not all be active in the current app routes.

### Build & Deployment

- **Dev**: Metro bundler for React Native + `tsx` for the Express server, both running concurrently
- **Prod**: `scripts/build.js` builds the Expo web bundle statically; Express serves it alongside the API
- **Domain**: Configured via `REPLIT_DEV_DOMAIN` and `REPLIT_INTERNAL_APP_DOMAIN` env vars

## External Dependencies

### APIs & Services

| Service | Purpose | Config |
|---|---|---|
| **OpenAI** | AI chat completions (streaming), audio (TTS/STT), image generation | `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL` env vars |
| **PostgreSQL** | Persistent storage for users and chat history | `DATABASE_URL` env var |

### Key Libraries

| Library | Role |
|---|---|
| `expo-router` | File-based navigation for React Native |
| `@tanstack/react-query` | Server state management and caching |
| `drizzle-orm` + `drizzle-zod` | Type-safe DB queries and schema validation |
| `react-native-reanimated` | Animations |
| `react-native-gesture-handler` | Touch gestures |
| `expo-linear-gradient` | Gradient UI elements |
| `expo-blur` | Blur effects on tab bar |
| `expo-glass-effect` | iOS Liquid Glass tab bar support |
| `expo-haptics` | Tactile feedback |
| `@react-native-async-storage/async-storage` | Local data persistence |
| `react-native-keyboard-controller` | Keyboard-aware layouts |
| `openai` (npm) | OpenAI API client for the server |
| `p-limit` + `p-retry` | Concurrency control and retry logic for batch AI calls |

### Environment Variables Required

- `DATABASE_URL` — PostgreSQL connection string
- `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI API key
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — OpenAI base URL (Replit AI proxy)
- `EXPO_PUBLIC_DOMAIN` — Public domain for the API (set automatically in dev via `REPLIT_DEV_DOMAIN`)
- `REPLIT_DEV_DOMAIN` / `REPLIT_INTERNAL_APP_DOMAIN` / `REPLIT_DOMAINS` — Replit environment URLs for CORS and build
Auth server for Docs Company (Discord OAuth2)

Quick start

1. Copy `.env.example` to `.env` and fill `DISCORD_CLIENT_SECRET`.

2. Install dependencies and run:

```bash
cd docs_company/auth-server
npm install
npm start
```

3. Open the frontend served at `http://localhost:8000` and click the "Entrar com Discord" button. The server will redirect you to Discord, then back to the callback which exchanges the code and sets a session cookie, finally redirecting to the frontend root.

Notes

- The `REDIRECT_URI` must be registered in your Discord application settings and should match the value in `.env` (default `http://localhost:3000/auth/callback`).
- The login cookie is HTTP-only, SameSite=Lax and valid for 8 hours. Its random token is stored as a SHA-256 hash in the persistent application state, so a page refresh or server restart does not immediately log the user out. On Render, configure Supabase because the local JSON backup is on ephemeral storage. Logging out removes the stored session.
- For production, also validate OAuth scopes and harden error handling; keep `SUPABASE_SERVICE_ROLE_KEY` server-side and never expose it to the frontend.
- Use the `state` cookie for CSRF protection (implemented here as a simple httpOnly cookie). You can also store the state server-side tied to a short-lived session.

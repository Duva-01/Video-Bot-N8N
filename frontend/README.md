# Frontend

Panel estático pensado para `Cloudflare Pages`.

## Archivos

- `index.html`
- `styles.css`
- `app.js`
- `config.js`

## Configuración

Edita `config.js` y define tu backend de Render:

```js
window.FACTS_APP_CONFIG = {
  API_BASE_URL: "https://video-bot-n8n.onrender.com",
  DEFAULT_USERNAME: "admin",
};
```

## Despliegue

En `Cloudflare Pages` puedes desplegar esta carpeta como sitio estático:

- build command: vacío
- output directory: `frontend`

El frontend consume:

- `POST /api/auth/login`
- `GET /api/control-center`
- `GET /api/logs`
- `GET /health`
- `POST /api/run-now`
- `POST /api/workflow-automation`

## Nota

`n8n` ya no se embebe aquí. Se abre en una pestaña aparte apuntando al backend:

```text
https://tu-backend.onrender.com/login?next=/app/
```

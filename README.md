# 🃏 La Barba Poker Room

Texas Hold'em multijugador en tiempo real — Node.js + Socket.io

---

## Estructura del proyecto

```
labarba/
├── server.js          ← Servidor principal (Express + Socket.io)
├── gameEngine.js      ← Motor del juego (lógica pura, sin red)
├── public/
│   └── index.html     ← Cliente web (lobby + mesa + chat)
├── package.json
└── README.md
```

---

## Instalación local

```bash
# 1. Instalar dependencias
npm install

# 2. Arrancar el servidor
node server.js

# 3. Abrir en el browser
# → http://localhost:3000
```

Cada jugador abre el mismo link. Uno crea la sala, comparte el código de 5 letras,
y los demás lo usan para entrar.

---

## Deploy en producción (Railway — recomendado)

1. Crear cuenta en https://railway.app
2. "New Project" → "Deploy from GitHub repo"
3. Subir este código a un repo de GitHub
4. Railway detecta automáticamente Node.js y corre `node server.js`
5. Te da una URL pública tipo `https://labarba-poker.up.railway.app`

Alternativas: **Render** (gratis con cold start) o **DigitalOcean** ($6/mes, más estable).

---

## Eventos Socket.io

| Evento (cliente → servidor) | Payload | Descripción |
|---|---|---|
| `room:create` | `{ name, config }` | Crea sala, devuelve `{ ok, code }` |
| `room:join` | `{ name, code }` | Entra a sala existente |
| `game:startHand` | — | Inicia nueva mano |
| `game:action` | `{ action, amount }` | fold / check / call / raise / allin |
| `chat:message` | `string` | Mensaje de chat |

| Evento (servidor → cliente) | Payload | Descripción |
|---|---|---|
| `room:state` | `GameState` | Estado completo (cartas propias visibles, ajenas ocultas) |
| `game:yourTurn` | `{ playerId }` | Notifica a quién le toca |
| `game:handOver` | `{ winnerId, handName, won }` | Fin de mano |
| `chat:message` | `{ from, text }` | Broadcast de chat |

---

## Próximos pasos sugeridos

- [ ] Persistencia de stacks entre manos (ya funciona en memoria)
- [ ] Avatares / fotos de perfil por jugador
- [ ] Historial de manos con replay
- [ ] Torneos con buy-in y estructura de premios
- [ ] Temporizador por turno (30s auto-fold)
- [ ] Soporte móvil nativo (React Native o PWA)

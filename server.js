const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname)));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const rooms = new Map();

wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentCode = null;
  let playerName = null;
  let playerIsHost = false;

  function send(data) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  function broadcastRoom(data, excludeSelf = false) {
    if (!currentRoom) return;
    for (const p of currentRoom.players) {
      if (excludeSelf && p.ws === ws) continue;
      if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(data));
    }
  }

  function broadcastAll(data) {
    if (!currentRoom) return;
    for (const p of currentRoom.players) {
      if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(data));
    }
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'join_room': {
        const { code, name, isHost } = msg;
        playerName = name;
        playerIsHost = isHost;
        currentCode = code;

        if (isHost) {
          if (rooms.has(code)) {
            send({ type: 'error', text: 'CÓDIGO YA EN USO — ELIGE OTRO' });
            return;
          }
          rooms.set(code, { players: [], started: false });
        }

        const room = rooms.get(code);
        if (!room) { send({ type: 'error', text: 'SALA NO ENCONTRADA' }); return; }
        if (room.players.length >= 2) { send({ type: 'error', text: 'SALA LLENA' }); return; }
        if (room.started) { send({ type: 'error', text: 'JUEGO YA EN CURSO' }); return; }

        room.players.push({ ws, name, isHost });
        currentRoom = room;

        send({ type: 'joined', name, isHost, code });

        const playerList = room.players.map(p => ({ name: p.name, isHost: p.isHost }));
        broadcastAll({ type: 'room_update', players: playerList, code });
        break;
      }

      case 'start_game': {
        if (!currentRoom || !playerIsHost) return;
        if (currentRoom.players.length < 2) {
          send({ type: 'error', text: 'ESPERA A QUE SE UNA UN RIVAL' });
          return;
        }
        currentRoom.started = true;
        broadcastAll({
          type: 'game_start',
          questionIds: msg.questionIds,
          diff: msg.diff,
          rounds: msg.rounds
        });
        break;
      }

      case 'score_update': {
        broadcastRoom({ type: 'opponent_score', score: msg.score, name: playerName }, true);
        break;
      }

      case 'game_over': {
        broadcastRoom({ type: 'opponent_finished', score: msg.score, name: playerName }, true);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!currentRoom) return;
    currentRoom.players = currentRoom.players.filter(p => p.ws !== ws);
    if (currentRoom.players.length === 0) {
      rooms.delete(currentCode);
    } else {
      broadcastAll({ type: 'opponent_left', name: playerName });
      currentRoom.started = false;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Draxys Studio on port ${PORT}`));

import express from 'express';
import path from 'path';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const app = express();
const PORT = 3000;

app.use(express.json());

// Simple API routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Create the unified HTTP Server
const server = createHttpServer(app);

// In-memory store for collaborative coding rooms
// Room ID -> { code: string, users: { [socketId: string]: { name: string, color: string, cursor?: { line: number, ch: number } } } }
interface Room {
  code: string;
  users: {
    [socketId: string]: {
      name: string;
      color: string;
      cursor?: { line: number; ch: number };
    };
  };
}

const rooms: { [roomId: string]: Room } = {};

// Create WebSocket Server
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade manually to attach on the same HTTP server port
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws: WebSocket) => {
  let currentRoomId: string | null = null;
  const socketId = Math.random().toString(36).substring(2, 11);

  ws.on('message', (messageData: string) => {
    try {
      const message = JSON.parse(messageData);
      const { type, roomId, payload } = message;

      if (type === 'join') {
        currentRoomId = roomId;
        
        // Initialize room if not exists
        if (!rooms[roomId]) {
          rooms[roomId] = {
            code: `// Dynamic Multiplayer Collaboration Room: ${roomId}\n// Type here to collaborate in real-time!\n\nfunction pairProgramming() {\n  console.log("Hello multiplayer!");\n}`,
            users: {}
          };
        }

        // Add user to room
        rooms[roomId].users[socketId] = {
          name: payload.name || `Coder ${socketId.substring(0, 4)}`,
          color: payload.color || '#3B82F6' // default tailwind blue
        };

        // Broadcast to existing room members
        broadcastToRoom(roomId, {
          type: 'user-joined',
          payload: {
            socketId,
            user: rooms[roomId].users[socketId],
            users: rooms[roomId].users,
            code: rooms[roomId].code
          }
        }, socketId);

        // Send current state to the joiner
        ws.send(JSON.stringify({
          type: 'init-state',
          payload: {
            socketId,
            code: rooms[roomId].code,
            users: rooms[roomId].users
          }
        }));
      }

      if (type === 'code-change') {
        if (currentRoomId && rooms[currentRoomId]) {
          rooms[currentRoomId].code = payload.code;
          // Broadcast to other members in the room
          broadcastToRoom(currentRoomId, {
            type: 'code-sync',
            payload: {
              code: payload.code,
              senderId: socketId
            }
          }, socketId);
        }
      }

      if (type === 'cursor-move') {
        if (currentRoomId && rooms[currentRoomId] && rooms[currentRoomId].users[socketId]) {
          rooms[currentRoomId].users[socketId].cursor = payload.cursor;
          // Broadcast position
          broadcastToRoom(currentRoomId, {
            type: 'cursor-sync',
            payload: {
              socketId,
              cursor: payload.cursor
            }
          }, socketId);
        }
      }

    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (currentRoomId && rooms[currentRoomId]) {
      delete rooms[currentRoomId].users[socketId];
      // If room is empty, optionally clean up after some time
      const remainingUserCount = Object.keys(rooms[currentRoomId].users).length;
      
      broadcastToRoom(currentRoomId, {
        type: 'user-left',
        payload: {
          socketId,
          users: rooms[currentRoomId].users
        }
      });

      if (remainingUserCount === 0) {
        delete rooms[currentRoomId];
      }
    }
  });

  // Helper to send a message to everyone in a room except the sender
  function broadcastToRoom(roomId: string, message: any, excludeSocketId?: string) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        // Since we can't easily map WebSocket objects directly to socketId without a map,
        // we can store metadata on the client, or broadcast to everyone and let clients identify/ignore.
        // For simplicity, we broadcast to all open sockets, and clients handle sender verification
        client.send(JSON.stringify({ ...message, roomId }));
      }
    });
  }
});

// Configure Vite or Static Assets based on environment
async function configureAssets() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

configureAssets().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[JS Academy Server] Running at http://localhost:${PORT}`);
  });
});

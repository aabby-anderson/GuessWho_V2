const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static('public'));

// Store active game rooms
const rooms = new Map();

// Generate a random 6-character room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Create a new room
    socket.on('create-room', (callback) => {
        const roomCode = generateRoomCode();
        const room = {
            code: roomCode,
            players: [socket.id],
            host: socket.id,
            gameState: null,
            ready: {}
        };
        
        rooms.set(roomCode, room);
        socket.join(roomCode);
        
        console.log(`Room ${roomCode} created by ${socket.id}`);
        callback({ success: true, roomCode, playerNumber: 1 });
    });

    // Join an existing room
    socket.on('join-room', (roomCode, callback) => {
        const room = rooms.get(roomCode);
        
        if (!room) {
            return callback({ success: false, error: 'Room not found' });
        }
        
        if (room.players.length >= 2) {
            return callback({ success: false, error: 'Room is full' });
        }
        
        room.players.push(socket.id);
        socket.join(roomCode);
        
        console.log(`${socket.id} joined room ${roomCode}`);
        
        // Notify the host that player 2 has joined
        io.to(room.host).emit('player-joined');
        
        callback({ success: true, roomCode, playerNumber: 2 });
    });

    // Sync roster to the other player
    socket.on('sync-roster', (data) => {
        const { roomCode, roster } = data;
        socket.to(roomCode).emit('roster-synced', roster);
    });

    // Sync selected people for game
    socket.on('sync-selected', (data) => {
        const { roomCode, selectedForGame } = data;
        socket.to(roomCode).emit('selected-synced', selectedForGame);
    });

    // Start the game (from roster screen)
    socket.on('start-game', (data) => {
        const { roomCode } = data;
        socket.to(roomCode).emit('game-started');
    });

    // Player picks their secret person
    socket.on('pick-secret', (data) => {
        const { roomCode, playerNumber, secretIndex } = data;
        socket.to(roomCode).emit('secret-picked', { playerNumber, secretIndex });
    });

    // Sync eliminated cards
    socket.on('sync-eliminated', (data) => {
        const { roomCode, playerNumber, eliminated } = data;
        socket.to(roomCode).emit('eliminated-synced', { playerNumber, eliminated });
    });

    // End turn
    socket.on('end-turn', (data) => {
        const { roomCode } = data;
        socket.to(roomCode).emit('turn-ended');
    });

    // Make a guess
    socket.on('make-guess', (data) => {
        const { roomCode, playerNumber, guessIndex } = data;
        socket.to(roomCode).emit('guess-made', { playerNumber, guessIndex });
    });

    // Win announcement
    socket.on('player-won', (data) => {
        const { roomCode, winner } = data;
        socket.to(roomCode).emit('game-won', { winner });
    });

    // Reset game
    socket.on('reset-game', (data) => {
        const { roomCode } = data;
        socket.to(roomCode).emit('game-reset');
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        // Find and clean up rooms
        for (const [code, room] of rooms.entries()) {
            if (room.players.includes(socket.id)) {
                // Notify other player
                socket.to(code).emit('player-disconnected');
                
                // Remove the room
                rooms.delete(code);
                console.log(`Room ${code} deleted due to player disconnect`);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

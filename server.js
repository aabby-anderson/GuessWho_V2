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
            ready: {},
            rematchRequests: new Set() // Track who wants rematch
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

    // Start the game - pass gameRoster data to Player 2
    socket.on('start-game', (data) => {
        const { roomCode, gameRoster } = data;
        const room = rooms.get(roomCode);
        
        if (room) {
            // Clear any previous rematch requests
            room.rematchRequests.clear();
        }
        
        console.log(`Game starting in room ${roomCode} with ${gameRoster?.length || 0} people`);
        socket.to(roomCode).emit('game-started', { gameRoster });
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

    // Make a guess - broadcast to BOTH players
    socket.on('make-guess', (data) => {
        const { roomCode, playerNumber, guessIndex } = data;
        console.log(`Guess made in room ${roomCode} by player ${playerNumber}`);
        io.to(roomCode).emit('guess-made', { playerNumber, guessIndex });
    });

    // Win announcement - broadcast to BOTH players
    socket.on('game-won', (data) => {
        const { roomCode, winner } = data;
        console.log(`Game won in room ${roomCode} - Player ${winner} wins! Broadcasting to BOTH players`);
        io.to(roomCode).emit('game-won', { winner });
    });

    // Reset game
    socket.on('reset-game', (data) => {
        const { roomCode } = data;
        socket.to(roomCode).emit('game-reset');
    });
    
    // Player wants rematch - FIX: Track both players and trigger rematch when both agree
    socket.on('player-wants-rematch', (data) => {
        const { roomCode } = data;
        const room = rooms.get(roomCode);
        
        if (!room) return;
        
        // Add this player's socket ID to rematch requests
        room.rematchRequests.add(socket.id);
        
        console.log(`Player ${socket.id} in room ${roomCode} wants rematch. Total requests: ${room.rematchRequests.size}/2`);
        
        // Notify other player that this player wants rematch
        socket.to(roomCode).emit('opponent-wants-rematch');
        
        // If both players want rematch, trigger the rematch
        if (room.rematchRequests.size === 2) {
            console.log(`Both players ready for rematch in room ${roomCode}. Triggering rematch...`);
            
            // Clear rematch requests for next game
            room.rematchRequests.clear();
            
            // Send rematch signal to BOTH players
            io.to(roomCode).emit('rematch-confirmed');
        }
    });
    
    // Player left room - FIX: Better cleanup and notification
    socket.on('player-left-room', (data) => {
        const { roomCode } = data;
        const room = rooms.get(roomCode);
        
        if (!room) return;
        
        console.log(`Player ${socket.id} left room ${roomCode}`);
        
        // Leave the socket.io room
        socket.leave(roomCode);
        
        // Notify other player
        socket.to(roomCode).emit('opponent-left-room');
        
        // Clean up the room
        rooms.delete(roomCode);
    });

    // Handle disconnect - FIX: Ensure other player gets notified properly
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        // Find and clean up rooms
        for (const [code, room] of rooms.entries()) {
            if (room.players.includes(socket.id)) {
                console.log(`Player ${socket.id} disconnected from room ${code}. Notifying other player...`);
                
                // Notify other player with explicit disconnect message
                io.to(code).emit('opponent-disconnected');
                
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

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatapp', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// MongoDB Schemas
const messageSchema = new mongoose.Schema({
  roomId: { type: String, required: true },
  sender: { type: String, required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const roomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  participants: [{ type: String }],
  createdAt: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);
const Room = mongoose.model('Room', roomSchema);

// Socket.IO Connection Handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle clearing all messages in a room
    socket.on('clear-room-chat', async ({ roomId }) => {
      try {
        await Message.deleteMany({ roomId }); // Delete all messages for this room from DB
        io.to(roomId).emit('room-chat-cleared'); // Notify all users in the room
        console.log(`All messages cleared in room ${roomId}`);
      } catch (error) {
        socket.emit('error', { message: 'Failed to clear chat' });
      }
    });
  // Join a room
  socket.on('join-room', async (data) => {
    const { roomId, username } = data;
    
    try {
      // Find or create room
      let room = await Room.findOne({ roomId });
      if (!room) {
        room = new Room({ roomId, participants: [username] });
        await room.save();
      } else if (!room.participants.includes(username)) {
        room.participants.push(username);
        await room.save();
      }

      // Join socket room
      socket.join(roomId);
      socket.roomId = roomId;
      socket.username = username;

      // Get recent messages (last 50)
      const messages = await Message.find({ roomId })
        .sort({ timestamp: -1 })
        .limit(50)
        .sort({ timestamp: 1 });

      // Send room data to user
      socket.emit('room-joined', {
        roomId,
        participants: room.participants,
        messages
      });

      // Notify others in room
      socket.to(roomId).emit('user-joined', {
        username,
        participants: room.participants
      });

      console.log(`${username} joined room ${roomId}`);
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // Handle new messages
  socket.on('send-message', async (data) => {
    const { roomId, sender, text } = data;
    
    try {
      // Save message to database
      const message = new Message({
        roomId,
        sender,
        text,
        timestamp: new Date()
      });
      await message.save();

      // Broadcast message to all users in room
      io.to(roomId).emit('new-message', {
        id: message._id,
        roomId,
        sender,
        text,
        timestamp: message.timestamp
      });

      console.log(`Message sent in room ${roomId} by ${sender}`);
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Handle typing indicators
  socket.on('typing', (data) => {
    socket.to(data.roomId).emit('user-typing', {
      username: data.username,
      isTyping: data.isTyping
    });
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    if (socket.roomId && socket.username) {
      try {
        const room = await Room.findOne({ roomId: socket.roomId });
        if (room) {
          room.participants = room.participants.filter(p => p !== socket.username);
          if (room.participants.length === 0) {
            await Room.deleteOne({ roomId: socket.roomId });
          } else {
            await room.save();
            socket.to(socket.roomId).emit('user-left', {
              username: socket.username,
              participants: room.participants
            });
          }
        }
      } catch (error) {
        console.error('Error handling disconnect:', error);
      }
    }
    console.log('User disconnected:', socket.id);
  });
});



// REST API Routes
app.get('/api/rooms/:roomId', async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    res.json(room);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/rooms/:roomId/messages', async (req, res) => {
  try {
    const messages = await Message.find({ roomId: req.params.roomId })
      .sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
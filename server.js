const fs = require("fs");
const express = require("express");
const { makeWASocket, fetchLatestBaileysVersion, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const http = require("http");
const socketIo = require("socket.io");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// Paths
const MESSAGES_FILE = "./messages.json";
const SESSION_DIR = "./session"; // Directory to store session credentials

// Initialize Express
// Middleware
app.use(express.static("public"));
app.use(bodyParser.json());

// Load or initialize `messages.json`
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, JSON.stringify([]));
const loadMessages = () => JSON.parse(fs.readFileSync(MESSAGES_FILE));
const saveMessages = (messages) => fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages));

// Initialize Baileys with saved session keys
const initBaileys = async () => {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    const socket = makeWASocket({
        auth: state,
        version,
    });

    // Listen for new messages
    socket.ev.on("messages.upsert", ({ messages }) => {
        const allMessages = loadMessages();
        messages.forEach((msg) => {
            if (msg.message) {
                const content =
                    msg.message.conversation ||
                    msg.message.imageMessage?.caption ||
                    msg.message.videoMessage?.caption ||
                    "[Media]";

                const messageData = {
                    jid: msg.key.remoteJid,
                    sender: msg.key.fromMe ? "You" : msg.pushName || msg.key.remoteJid,
                    content,
                    timestamp: msg.messageTimestamp,
                };

                // Save to messages.json
                allMessages.push(messageData);
                saveMessages(allMessages);

                // Emit message to the frontend via WebSocket
                io.emit("new_message", messageData);
            }
        });
    });

    // Save credentials on update
    socket.ev.on("creds.update", saveCreds);

    return socket;
};

// Initialize Baileys socket
let whatsappSocket;
initBaileys()
    .then((sock) => {
        whatsappSocket = sock;
        console.log("Connected to WhatsApp");
    })
    .catch((err) => console.error("Failed to initialize Baileys:", err));

// Routes
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/chat/:jid", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "chat.html"));
});

app.get("/api/messages", (req, res) => {
    const allMessages = loadMessages();
    const chatList = allMessages.reduce((acc, msg) => {
        const chat = acc.find((c) => c.jid === msg.jid);
        if (chat) {
            if (msg.timestamp > chat.timestamp) {
                chat.lastMessage = msg.content;
                chat.timestamp = msg.timestamp;
            }
        } else {
            acc.push({
                jid: msg.jid,
                sender: msg.sender,
                lastMessage: msg.content,
                timestamp: msg.timestamp,
            });
        }
        return acc;
    }, []);
    chatList.sort((a, b) => b.timestamp - a.timestamp);
    res.json(chatList);
});

app.get('/messages.json', (req, res) => {
    res.sendFile(path.join(__dirname, "messages.json"));
});

app.get("/api/messages/:jid", (req, res) => {
    const { jid } = req.params;
    const chatMessages = loadMessages().filter((msg) => msg.jid === jid);
    res.json(chatMessages);
});

// WebSocket Connection
io.on("connection", (socket) => {
    console.log("Client connected via WebSocket");
    socket.on("disconnect", () => {
        console.log("Client disconnected");
    });
});

app.post("/send-message", async (req, res) => {
    const { jid, message, replyTo } = req.body;
    try {
        if (whatsappSocket) {
            if (replyTo) {
                const messages = loadMessages();
                const replyMessage = messages.find((msg) => msg.jid === jid && msg.timestamp === replyTo);

                if (replyMessage) {
                    await whatsappSocket.sendMessage(jid, {
                        text: message,
                        quoted: {
                            key: { remoteJid: jid, id: replyTo },
                            message: { conversation: replyMessage.content },
                        },
                    });
                }
            } else {
                await whatsappSocket.sendMessage(jid, { text: message });
            }
            res.sendStatus(200);
        } else {
            res.sendStatus(500);
        }
    } catch (error) {
        console.error("Error sending message:", error);
        res.sendStatus(500);
    }
});

app.post("/send-sticker", async (req, res) => {
    const { jid, stickerPath } = req.body;
    try {
        if (whatsappSocket && fs.existsSync(stickerPath)) {
            await whatsappSocket.sendMessage(jid, { sticker: { url: stickerPath } });
            res.sendStatus(200);
        } else {
            res.status(400).send("Sticker file not found or session not initialized.");
        }
    } catch (error) {
        console.error("Error sending sticker:", error);
        res.sendStatus(500);
    }
});

app.post("/send-image", async (req, res) => {
    const { jid, imagePath, caption } = req.body;
    try {
        if (whatsappSocket && fs.existsSync(imagePath)) {
            await whatsappSocket.sendMessage(jid, {
                image: { url: imagePath },
                caption: caption || "",
            });
            res.sendStatus(200);
        } else {
            res.status(400).send("Image file not found or session not initialized.");
        }
    } catch (error) {
        console.error("Error sending image:", error);
        res.sendStatus(500);
    }
});

// WebSocket connection
io.on('connection', (socket) => {
    console.log('User connected');

    // Example event to listen for new messages
    socket.on('sendMessage', (message) => {
        saveMessage(message); // Save the message to storage

        // Broadcast to all connected clients
        io.emit('newMessage', message);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Start server
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
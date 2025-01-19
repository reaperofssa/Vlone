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
const SESSION_DIR = "./session";
const MESSAGES_FILE = "./messages.json";

// Middleware
app.use(express.static("public"));
app.use(bodyParser.json());

// Load or initialize messages.json
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, JSON.stringify([]));
const loadMessages = () => JSON.parse(fs.readFileSync(MESSAGES_FILE));
const saveMessages = (messages) => fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages));

// Initialize Baileys session
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
                    "[Media]";

                allMessages.push({
                    jid: msg.key.remoteJid,
                    sender: msg.key.fromMe ? "user" : msg.pushName || msg.key.remoteJid,
                    content,
                    timestamp: msg.messageTimestamp,
                });

                saveMessages(allMessages);

                // Emit message via WebSocket
                io.emit("new_message", msg);
            }
        });
    });

    // Save credentials on update
    socket.ev.on("creds.update", saveCreds);

    return socket;
};

// Baileys setup
let whatsappSocket;
initBaileys().then((sock) => (whatsappSocket = sock));

// Routes
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/chat/:jid", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "chat.html"));
});

app.get("/api/messages/:jid", (req, res) => {
    const { jid } = req.params;
    const messages = loadMessages().filter((msg) => msg.jid === jid);
    res.json(messages);
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
io.on("connection", (socket) => {
    console.log("Client connected");
});

// Start server
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
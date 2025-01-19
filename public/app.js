const socket = io();

// Listen for new messages
socket.on('new_message', (msg) => {
    const chatBox = document.getElementById('chat-box');
    const jid = window.location.pathname.split('/chat/')[1];

    if (msg.key.remoteJid === jid) {
        const messageDiv = document.createElement('div');
        messageDiv.className = msg.key.fromMe ? 'message user' : 'message';
        messageDiv.innerHTML = `<p>${msg.message.conversation || '[Media]'}</p>`;
        chatBox.appendChild(messageDiv);
    }
});
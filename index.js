const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 7860;

// Events limit එක වැඩි කිරීම
require('events').EventEmitter.defaultMaxListeners = 500;

// Middleware (මේවා routes වලට කලින් තියෙන්න ඕනේ)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// CSS, JS, Images වගේ static files load වෙන්න මේක ඕනේ
app.use(express.static(path.join(__dirname, '.')));

// Routes
let code = require('./pair');
app.use('/code', code);

// Pairing page එක පෙන්වන්න
app.get('/pair', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

// Main UI එක පෙන්වන්න (Link එකට ගිය ගමන් පෙනෙන තැන)
app.get('/main', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

// Root URL එකට (/) ගිය ගමන් පෙන්වන දේ - මෙතනට main.html එකම දෙමු
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

// Server එක Start කිරීම
app.listen(PORT, () => {
    console.log(`
---------------------------------------
Server is live on port: ${PORT}
Hugging Face URL: http://localhost:${PORT}
---------------------------------------
    `);
});

module.exports = app;
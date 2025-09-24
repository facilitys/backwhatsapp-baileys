import {
    makeWASocket,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    downloadMediaMessage
} from '@whiskeysockets/baileys';

import { useMySQLAuthState } from 'mysql-baileys';
import qrcode from 'qrcode';
import mysql from 'mysql2/promise';
import express from 'express';
import pino from 'pino';
import cors from 'cors'; // Importa o módulo cors
import https from 'https'; // Alterado de http para https
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as fspromises from 'fs/promises';
import crypto from 'crypto';
import multer from 'multer'; // Importa multer para upload de arquivos
import axios from 'axios'; // Para baixar imagens de URLs.
import DatabaseService from './services/DatabaseService.js';
import ffmpeg from 'fluent-ffmpeg';
import { Writable } from 'stream';
import { Server } from "socket.io";
import { authConfig } from './config/db.config.js';

// Configuração do Express
const app = express();
const port =  process.env.EXPRESS_PORT;
const sockeioport =  process.env.SOCKETIO_PORT;
const appsocket = express();
const httpsapp = express();

// recria __dirname no ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Carrega o certificado e a chave privada
const privateKey = fs.readFileSync(path.join(__dirname, 'server.key'), 'utf8');
const certificate = fs.readFileSync(path.join(__dirname, 'server.crt'), 'utf8');
const credentials = { key: privateKey, cert: certificate };

const serversocket = https.createServer(credentials, appsocket);
// const httpServer = https.createServer(credentials, httpsapp);
const appserver = https.createServer(credentials, app);

const dbService = new DatabaseService();


// serversocket é o servidor HTTP/HTTPS já criado
const io = new Server(serversocket, {
    cors: {
        origin: [
            "https://localhost:6001",
            "https://localhost:3002",
            "https://nuxt.localhost",
            "http://localhost",
            "http://172.20.18.49",
            "http://172.20.18.90:6001",
            "http://172.20.18.90:6002",
            "http://172.20.16.38:6001",
            "http://172.20.16.38:6443",
            "http://172.20.16.38:6444"
        ],
        methods: ["GET", "POST"],
        allowedHeaders: ["my-custom-header"],
        credentials: true
    }
});
// Configuração do CORS para permitir apenas http://localhost:6001
app.use(cors({
    origin: ['http://172.20.18.90:6001', 'https://nuxt.localhost', 'https://localhost:6001', 'https://localhost:3002'],
    methods: ['GET', 'POST', "PUT"], // Métodos permitidos
    allowedHeaders: ['Content-Type', 'Authorization'], // Cabeçalhos permitidos
    credentials: true // Permite envio de cookies, se necessário
}));

app.use(express.json()); // Para processar JSON no corpo das requisições
const logger = pino()

// Directory to store downloaded audio files
const VIDEO_STORAGE_PATH = path.join(__dirname, 'uploads/video');
const AUDIO_STORAGE_PATH = path.join(__dirname, 'uploads/audio');
const MEDIA_STORAGE_PATH = path.join(__dirname, 'uploads/image');
const DOCUMENT_STORAGE_PATH = path.join(__dirname, 'uploads/document');

// Cria diretórios de forma assíncrona
async function ensureDirectories() {
    try {
        await fspromises.mkdir(AUDIO_STORAGE_PATH, { recursive: true });
        console.log('✅ Diretório uploads criado ou já existe');
        await fspromises.mkdir(MEDIA_STORAGE_PATH, { recursive: true });
        console.log('✅ Diretório media criado ou já existe');
        await fspromises.mkdir(DOCUMENT_STORAGE_PATH, { recursive: true });
        console.log('✅ Diretório document criado ou já existe');
        await fspromises.mkdir(VIDEO_STORAGE_PATH, { recursive: true });
        console.log('✅ Diretório video criado ou já existe');
    } catch (err) {
        console.error('❌ Erro ao criar diretórios:', err);
        throw err; // Para interromper a execução se os diretórios não puderem ser criados
    }
}

// Executa a criação dos diretórios no início
(async () => {
    await ensureDirectories();
})();



const uploadImage = multer({
    dest: MEDIA_STORAGE_PATH,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Apenas imagens são permitidas'));
        }
        cb(null, true);
    }
});
const uploadAudio = multer({
    dest: AUDIO_STORAGE_PATH, // Salva no diretório de uploads de áudio
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('audio/')) {
            return cb(new Error('Apenas arquivos de áudio são permitidos'));
        }
        cb(null, true);
    }
});
const uploadVideo = multer({
    dest: VIDEO_STORAGE_PATH, // Salva no diretório de uploads de vídeo
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('video/')) {
            return cb(new Error('Apenas arquivos de vídeo são permitidos'));
        }
        cb(null, true);
    }
});
const uploadDocument = multer({
    dest: DOCUMENT_STORAGE_PATH,
    limits: { fileSize: 100 * 1024 * 1024 }, // Limite de 100MB (máximo do WhatsApp para documentos)
    fileFilter: (req, file, cb) => {
        if (typeof cb !== 'function') {
            console.error('Callback do fileFilter não é uma função:', cb);
            return cb(new Error('Erro interno no multer: callback inválido'));
        }
        const allowedMimes = [
            'application/pdf', // PDF

            'application/msword', // DOC
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX

            'application/vnd.ms-excel', // XLS
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX

            'text/csv', // CSV
            'text/plain', // TXT

            'application/vnd.ms-powerpoint', // PPT
            'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX

            'application/vnd.oasis.opendocument.text', // ODT
            'application/vnd.oasis.opendocument.spreadsheet', // ODS

            'application/rtf', // RTF
            'application/json', // JSON
            'application/xml', // XML
            'text/xml', // XML (alternativo)

            'application/zip' // ZIP
        ];

        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX ou TXT são permitidos'));
        }
    }
}).single('document'); // Define o campo esperado como 'document'


// Map para armazenar instâncias dos clientes WhatsApp
const clients = new Map();
// Map para mapear IDs temporários para números de telefone após autenticação
const tempSessionMap = new Map();
// Contador de tentativas de reconexão por sessão
const reconnectAttempts = new Map();

async function connectToWhatsApp(sessionId, idusuario) {
    let version;
    try {
        // Verifica a versão mais recente do Baileys
        const { error, version: fetchedVersion } = await fetchLatestBaileysVersion();
      
        if (error) {
            console.warn(`Erro no fetch de versão: ${error}. Usando versão manual.`);
            version = [2, 3000, 1023223821]; // Versão estável recente (ajuste com base em testes; verifique GitHub para atual)
        } else {
            version = fetchedVersion;
        }
      
        // Configura o estado de autenticação no MySQL
        authConfig.session = sessionId
          const { state, saveCreds, removeCreds } = await useMySQLAuthState(authConfig);
        // const { state, saveCreds, removeCreds } = await useMySQLAuthState({
        //     session: sessionId,
        //     host: '172.20.18.49',
        //     port: 3306,
        //     user: 'roberto',
        //     password: 'tecexecadm',
        //     database: 'hml',
        //     tableName: 'auth',
        // });


        // Cria uma instância do cliente WhatsApp
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            version: version,
            printQRInTerminal: false,
        });

        // Armazena o cliente no Map com sessionId temporário
        clients.set(sessionId, { sock, idusuario, qrcode: null, numerotelefone: '' });
        tempSessionMap.set(sessionId, { idusuario, sessionId });

        // Manipula atualizações de conexão
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                try {
                    const qrFile = `qrcode_${sessionId}.png`;
                    await qrcode.toFile(qrFile, qr, { type: 'png' });
                    const qrCodeUrl = await qrcode.toDataURL(qr);
                    const cli = clients.get(sessionId);
                    if (cli) {
                        cli.qrcode = qrCodeUrl;
                        clients.set(sessionId, cli);
                        io.emit('qrCode', { sessionId, qrCode: qrCodeUrl, idusuario: cli.idusuario });
                    }
                } catch (err) {
                    console.error(`Erro ao gerar QR Code para ${sessionId}:`, err);
                }
            }

            if (connection === 'open') {
                const user = sock.user;
                if (user && user.id) {
                    const phoneNumber = user.id.split(':')[0]; // Extrai o número de telefone
                    console.log(`🔵🔵🔵🔵🔵🔵🔵🔵 Conexão estabelecida para ${phoneNumber} (sessionId: ${sessionId})`);
                    dbService.saveSession({idusuario,phoneNumber})
                    // Atualiza o Map com o número de telefone como sessionId
                    const cli = clients.get(sessionId);
                    if (cli) {
                        cli.numerotelefone = phoneNumber;
                        clients.set(sessionId, cli);

                        // Se o sessionId inicial não for o número de telefone, atualiza o Map
                        if (sessionId !== phoneNumber) {
                            clients.set(phoneNumber, cli);
                            clients.delete(sessionId);
                            tempSessionMap.set(phoneNumber, { idusuario, sessionId });
                            tempSessionMap.delete(sessionId);

                            console.log(`🟡🟡🟡🟡🟡SessionId atualizado de ${sessionId} para ${phoneNumber}`);
                            // Atualiza o estado de autenticação no MySQL para o novo sessionId
                            await useMySQLAuthState({
                                session: phoneNumber,
                                host: '172.20.18.49',
                                port: 3306,
                                user: 'roberto',
                                password: 'tecexecadm',
                                database: 'hml',
                                tableName: 'auth',
                            });
                        }
                    }
                    console.log(`[1;45m 🟣🟣🟣🟣🟣 index2.js:233 'Conexão estabelecida' `, { sessionId: phoneNumber, status: 'connected' }, ' [0m ')
                    io.emit('connectionStatus', { sessionId: sessionId, currentSessionId: phoneNumber, status: 'connected' });
                    //   console.log(`%c🟠🟠🟠🟠🟠 index2.js:235 'clients' `, ' background-color:orange; color: black; font-size: 16px;', clients)
                    reconnectAttempts.delete(sessionId); // Reseta tentativas de reconexão
                } else {
                    console.log(`Não foi possível obter o número do usuário para ${sessionId}`);
                }
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(`🟠Conexão fechada para ${sessionId}:`, lastDisconnect?.error, 'Reconectar:', shouldReconnect);

                if (shouldReconnect) {
                    const attempts = (reconnectAttempts.get(sessionId) || 0) + 1;
                    const maxReconnectAttempts = 3;
                    if (attempts <= maxReconnectAttempts) {
                        reconnectAttempts.set(sessionId, attempts);
                        console.log(`🟠🟠Tentativa de reconexão ${attempts}/${maxReconnectAttempts} para ${sessionId}`);
                        setTimeout(() => connectToWhatsApp(sessionId, idusuario), 1000);
                    } else {
                        console.log(`🟠🟠🟠Máximo de tentativas de reconexão atingido para ${sessionId}`);
                        clients.delete(sessionId);
                        tempSessionMap.delete(sessionId);
                        reconnectAttempts.delete(sessionId);
                    }
                } else {
                    console.log(`🟠🟠🟠🟠Sessão ${sessionId} encerrada. Limpando credenciais e gerando novo QR Code.`);
                    await removeCreds();
                    clients.delete(sessionId);
                    // BUSCA O NUMERO DO TELEFONE DO IDSESSAO ORIGINAL
                    const result = [...tempSessionMap.entries()].find(([key, value]) => value.sessionId === sessionId);

                    if (result) {
                        const [key, value] = result;
                        console.log("🟢🟠🟠 Found:", key, value);
                        tempSessionMap.delete(sessionId);
                        reconnectAttempts.delete(sessionId);
                        connectToWhatsApp(key, idusuario); // ENVIA A KEY COMO IDSESSAO ONDE KEY É O NUMERO DO TELEFONES LOCALIZADO NO tempSessionMap
                    } else {
                        console.log("Not found");
                        console.log(`%c🔴🔴🔴🔴🔴 index2.js:274 ' NAO FOI LOCALIZADO A SESSIION ID NO TEMPSESSIOnMap' `, ' background-color:red; color: white; font-size: 16px;')
                    }


                }
            }
        });

        // Salva as credenciais quando atualizadas
        sock.ev.on('creds.update', saveCreds);

        // Manipula o evento messaging-history.set
        sock.ev.on('messaging-history.set', async ({ chats, contacts, messages, syncType }) => {
            return
            for (const message of messages) {
                // Inicializa com o sessionId original (pode ser temporário)

                let currentSessionId = sessionId;

                // Busca o cliente no Map usando o sessionId original
                let cli = clients.get(sessionId);



                // Se o cliente não for encontrado ou não tiver numerotelefone, tenta encontrar pelo idusuario
                if (!cli || !cli.numerotelefone) {
                    // Procura uma entrada no tempSessionMap que corresponda ao idusuario
                    // const sessionEntry = [...tempSessionMap.entries()].find(
                    //     ([_, value]) => value.idusuario === idusuario
                    // );
                    // if (sessionEntry) {
                    //     currentSessionId = sessionEntry[0]; // Atualiza para o número de telefone
                    //     cli = clients.get(currentSessionId);
                    // } else {
                    //     console.error(`Sessão para idusuario ${idusuario} não encontrada no tempSessionMap. Ignorando mensagem do histórico.`);
                    //     continue;
                    // }
                    // BUSCA O NUMERO DO TELEFONE DO IDSESSAO ORIGINAL
                    const result = [...tempSessionMap.entries()].find(([key, value]) => value.sessionId === sessionId);

                    if (result) {
                        const [key, value] = result;
                        currentSessionId = key; // Atualiza para o número de telefone
                        cli = clients.get(currentSessionId);

                    } else {
                        console.error(`Sessão para idusuario ${idusuario} não encontrada no tempSessionMap. Ignorando mensagem do histórico.`);
                        continue;
                    }
                }

                // Garante que o número de telefone esteja definido
                if (!cli || !cli.numerotelefone) {
                    console.warn(`Número de telefone não definido para ${currentSessionId}. Aguardando autenticação.`);
                    continue;
                }

                // Salva a mensagem do histórico no banco de dados
                const saveMessageresult = await dbService.saveMessage(message, currentSessionId, cli);
                if (saveMessageresult.status == 200) {
                    const saveContactInsertedId = await dbService.saveContact(saveMessageresult.dados);
                } else {
                    //console.error(`🟡 Não foi inserido mensgem de histórico para ${currentSessionId} - ${saveMessageresult.motivo} 🟡`);
                }

            }
        });

        // Manipula mensagens recebidas em tempo real
        sock.ev.on('messages.upsert', async ({ messages }) => {


            for (const message of messages) {
                console.log(`%c🟠🟠🟠🟠🟠 index2.js:346 'message' `, ' background-color:orange; color: black; font-size: 16px;', message)
                // Inicializa com o sessionId original (pode ser temporário)
                let currentSessionId = sessionId;

                // Busca o cliente no Map usando o sessionId original
                let cli = clients.get(sessionId);

                // Se o cliente não for encontrado ou não tiver numerotelefone, tenta encontrar pelo idusuario
                if (!cli || !cli.numerotelefone) {
                    // // Procura uma entrada no tempSessionMap que corresponda ao idusuario
                    // const sessionEntry = [...tempSessionMap.entries()].find(
                    //     ([_, value]) => value.idusuario === idusuario
                    // );
                    // if (sessionEntry) {
                    //     currentSessionId = sessionEntry[0]; // Atualiza para o número de telefone
                    //     cli = clients.get(currentSessionId);
                    // } else {
                    //     console.error(`Sessão para idusuario ${idusuario} não encontrada no tempSessionMap. Ignorando mensagem.`);
                    //     continue;
                    // }
                    const result = [...tempSessionMap.entries()].find(([key, value]) => value.sessionId === sessionId);

                    if (result) {
                        const [key, value] = result;
                        currentSessionId = key; // Atualiza para o número de telefone
                        cli = clients.get(currentSessionId);

                    } else {
                        console.error(`Sessão para idusuario ${idusuario} não encontrada no tempSessionMap. Ignorando mensagem do histórico.`);
                        continue;
                    }
                }

                // Garante que o número de telefone esteja definido
                if (!cli || !cli.numerotelefone) {
                    console.warn(`Número de telefone não definido para ${currentSessionId}. Aguardando autenticação.`);
                    continue;
                }
                console.log(`%c 🟢🟢🟢🟢 index2.js:305 'cli' `, ' background-color:green; color: white; font-size: 16px;', cli.sock.user)
                // Salva a mensagem no banco de dados
                const saveMessageresult = await dbService.saveMessage(message, currentSessionId, cli);

                if (saveMessageresult.status == 200) {
                    const saveContactInsertedId = await dbService.saveContact(saveMessageresult.dados);

                    if (saveContactInsertedId) {
                        const newContactNotify = {
                            contato: saveMessageresult.dados.contato,
                            numerotelefone: saveMessageresult.dados.numerotelefone,
                            jid: saveMessageresult.dados.jid,
                            idusuario: saveMessageresult.dados.idusuario,
                            id: saveContactInsertedId,
                        };
                        io.emit('newContact', newContactNotify);
                    }
                }
                if (message.message?.videoMessage) {
                    const videoMessage = message.message.videoMessage;
                    const fileName = `${Date.now()}-${message.key.id}.${videoMessage.mimetype.includes('ogg') ? 'ogg' : 'mp4'}`;
                    const filePath = path.join(VIDEO_STORAGE_PATH, fileName);

                    try {
                        // Download and decrypt the video message
                        const buffer = await downloadMediaMessage(message, 'buffer', {});
                        fs.writeFileSync(filePath, buffer);
                        const newMessage = {
                            sessionId,
                            currentSessionId,
                            message,
                            type: 'video',
                            fileUrl: `/uploads/v/${fileName}`,
                            mimetype: videoMessage.mimetype,
                            duration: videoMessage.seconds,
                            timestamp: new Date(message.messageTimestamp * 1000).toISOString(),
                            isFromUser: false,
                            fromApp: (!message.status) ? false : true,
                            idusuario: cli.idusuario
                        }
                        const newMessageNotify = { remoteJid: message.key.remoteJid, pushName: message.pushName, text: 'text', idusuario: cli.idusuario }
                        io.emit('newMessage', newMessage);
                        io.emit('newMessageNotify', newMessageNotify);
                    } catch (error) {
                        console.error('Error downloading video message:', error);
                        io.emit('error', { message: 'Failed to download video message', error: error.message });
                    }
                }
                else if (message.message?.audioMessage) {
                    const audioMessage = message.message.audioMessage;
                    const fileName = `${Date.now()}-${message.key.id}.${audioMessage.mimetype.includes('ogg') ? 'ogg' : 'mp3'}`;
                    const filePath = path.join(AUDIO_STORAGE_PATH, fileName);

                    try {
                        // Download and decrypt the audio message
                        const buffer = await downloadMediaMessage(message, 'buffer', {});
                        fs.writeFileSync(filePath, buffer);
                        const newMessage = {
                            sessionId,
                            currentSessionId,
                            message,
                            type: 'audio',
                            fileUrl: `/uploads/a/${fileName}`,
                            mimetype: audioMessage.mimetype,
                            duration: audioMessage.seconds,
                            timestamp: new Date(message.messageTimestamp * 1000).toISOString(),
                            isFromUser: false,
                            fromApp: (!message.status) ? false : true,
                            idusuario: cli.idusuario
                        }
                        const newMessageNotify = { remoteJid: message.key.remoteJid, pushName: message.pushName, text: 'text' , idusuario: cli.idusuario }

                        io.emit('newMessage', newMessage);
                        io.emit('newMessageNotify', newMessageNotify);
                    } catch (error) {
                        console.error('Error downloading audio message:', error);
                        io.emit('error', { message: 'Failed to download audio message', error: error.message });
                    }
                }
                else if (message.message?.imageMessage) {
                    const imageMessage = message.message.imageMessage;
                    const fileExtension = imageMessage.mimetype.includes('jpeg') ? 'jpg' : imageMessage.mimetype.includes('png') ? 'png' : 'jpg';
                    const fileName = `${Date.now()}-${message.key.id}.${fileExtension}`;
                    const filePath = path.join(MEDIA_STORAGE_PATH, fileName);

                    try {
                        const buffer = await downloadMediaMessage(message, 'buffer', {});
                        fs.writeFileSync(filePath, buffer);
                        const newMessage = {
                            sessionId,
                            currentSessionId,
                            message,
                            type: 'image',
                            imageMessage,
                            fileUrl: `/uploads/m/${fileName}`,
                            mimetype: imageMessage.mimetype,
                            duration: 0,
                            timestamp: new Date(message.messageTimestamp * 1000).toISOString(),
                            isFromUser: false,
                            fromApp: (!message.status) ? false : true,
                            caption: imageMessage.caption || "",
                            idusuario: cli.idusuario
                        }
                        const newMessageNotify = { remoteJid: message.key.remoteJid, pushName: message.pushName, text: 'text', idusuario: cli.idusuario }
                        io.emit('newMessage', newMessage);
                        io.emit('newMessageNotify', newMessageNotify);
                    } catch (error) {
                        console.error('Error downloading image message:', error);
                        io.emit('error', { message: 'Failed to download image message', error: error.message });
                    }
                }
                else if (message.message?.documentMessage || message.message?.documentWithCaptionMessage) {
                    const documentMessage = message.message.documentMessage || message.message?.documentWithCaptionMessage.message.documentMessage;
                    const fileExtension = (() => {
                        const mimeToExtension = {
                            'application/pdf': 'pdf',

                            'application/msword': 'doc',
                            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',

                            'application/vnd.ms-excel': 'xls',
                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',

                            'application/vnd.ms-powerpoint': 'ppt',
                            'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',

                            'text/plain': 'txt',
                            'text/csv': 'csv',

                            'application/vnd.oasis.opendocument.text': 'odt',
                            'application/vnd.oasis.opendocument.spreadsheet': 'ods',

                            'application/rtf': 'rtf',
                            'application/json': 'json',
                            'application/xml': 'xml',
                            'text/xml': 'xml',

                            'application/zip': 'zip'
                        };

                        return mimeToExtension[documentMessage.mimetype] || 'bin';
                    })();
                    const fileName = `${Date.now()}-${message.key.id}.${fileExtension}`;
                    const filePath = path.join(DOCUMENT_STORAGE_PATH, fileName);

                    try {
                        const buffer = await downloadMediaMessage(message, 'buffer', {});
                        fs.writeFileSync(filePath, buffer);

                        const newMessage = {
                            sessionId,
                            currentSessionId,
                            message,
                            type: 'document',
                            documentMessage,
                            fileUrl: `/uploads/d/${fileName}`,
                            mimetype: documentMessage.mimetype,
                            duration: 0,
                            timestamp: new Date(message.messageTimestamp * 1000).toISOString(),
                            isFromUser: false,
                            fromApp: (!message.status) ? false : true,
                            caption: documentMessage.caption || "",
                            idusuario: cli.idusuario
                        }

                        const newMessageNotify = { remoteJid: message.key.remoteJid, pushName: message.pushName, text: 'text', idusuario: cli.idusuario }
                        io.emit('newMessage', newMessage);
                        io.emit('newMessageNotify', newMessageNotify);
                    } catch (error) {
                        console.error('Error downloading document message:', error);
                        io.emit('error', { message: 'Failed to download document message', error: error.message });
                    }
                }
                else {

                    const newMessage = {
                        sessionId,
                        currentSessionId,
                        message,
                        type: 'text',
                        fileUrl: ``,
                        mimetype: '',
                        duration: '',
                        timestamp: new Date(message.messageTimestamp * 1000).toISOString(),
                        isFromUser: false,
                        fromApp: (!message.status) ? false : true,
                        idusuario: cli.idusuario
                    }
                    
                    if (message.message?.conversation) {
                        const text = message.message.conversation;
                        const newMessageNotify = { remoteJid: message.key.remoteJid, pushName: message.pushName, text: text, idusuario: cli.idusuario }
                        io.emit('newMessage', newMessage);
                        io.emit('newMessageNotify', newMessageNotify);
                       
                        
                    }
                    else if (message.message?.extendedTextMessage?.text) {
                        const text = message.message.extendedTextMessage.text;
                        const newMessageNotify = { remoteJid: message.key.remoteJid, pushName: message.pushName, text: text }
                        io.emit('newMessage', newMessage);
                        io.emit('newMessageNotify', newMessageNotify);
                    }

                }

            }
            // let fromApp = true
            // if (!messages[0].status) {
            //     fromApp = false
            // }
            // io.emit('newMessage', { sessionId, messages, fromApp: fromApp }); // Emite nova mensagem para clientes
            // io.emit('newMessage2', { sessionId, messages, fromApp: fromApp }); // Emite nova mensagem para clientes
        });

        sock.ev.on('messages.update', async (message) => {

        });

        // Manipula contatos
        sock.ev.on('contacts.upsert', async (contacts) => {
            console.log(`Contatos atualizados para ${sessionId}: ${contacts.length} contatos recebidos`);

            //    io.emit('contactsUpdate', { sessionId, contacts }); // Emite atualização de contatos
            // for (const contact of contacts) {
            //     await saveContactToDB(contact, sessionId);
            // }
        });

        return sock;
    } catch (err) {
        console.error(`Erro ao conectar sessão ${sessionId}:`, err);
        clients.delete(sessionId);
        tempSessionMap.delete(sessionId);
        throw err;
    }
}

// Função para iniciar uma nova sessão
async function startSession(sessionId, idusuario) {
    try {
        const client = await connectToWhatsApp(sessionId, idusuario);
        console.log(`Sessão iniciada para ${sessionId}`);
        return client;
    } catch (err) {
        console.error(`Erro ao iniciar sessão ${sessionId}:`, err);
    }
}

// Função para listar clientes conectados
function listConnectedClients() {
    console.log('🙂 Clientes conectados:');
    clients.forEach((client, sessionId) => {
        console.log(`- ${sessionId} (Telefone: ${client.numerotelefone}, Usuário: ${client.idusuario})`);
    });
}

setInterval(listConnectedClients, 60000); // Lista a cada 60 segundos

async function sendMessage(sessionId, recipientJid, text, idusuario) {
    console.log(`%c 🟢🟢🟢🟢 index.js:437 'sessionId, recipientJid, text' `, ' background-color:green; color: white; font-size: 16px;', 'Enviando mensagem da sessao: ', sessionId, ' parao numero: ', recipientJid, ' Mensagem:', text)
    const sock = clients.get(sessionId);
    console.log(`%c🔴🔴🔴🔴🔴 index2.js:620 'socksocksock' `, ' background-color:red; color: white; font-size: 16px;', sock, idusuario)
    if (!sock) {
        //throw new Error(`Cliente WhatsApp para sessão ${sessionId} não está conectado.`);
        console.log(`%c🔴🔴🔴🔴🔴 index2.js:642 'Cliente WhatsApp para sessão ${sessionId} e idusuario ${idusuario} não está conectado.' `, ' background-color:red; color: white; font-size: 16px;', 'Cliente WhatsApp para sessão ${sessionId} não está conectado.')
        io.emit('sessaoDesconectada', { sessionId, idusuario });
        return
    }
    try {
        const message = {
            text: text
        };
        console.log(`%c🔵🔵🔵🔵🔵 index2.js:679 'sock.sock' `, ' background-color:blue; color: white; font-size: 16px;', sock.sock)
        const sentMessage = await sock.sock.sendMessage(recipientJid, message);
        //console.log(`Mensagem enviada para ${recipientJid} na sessão ${sessionId}: ${text}`);
        return sentMessage;
    } catch (err) {
        io.emit('sessaoDesconectada', sessionId);
        console.error(`%c🔴🟢🟢🟢🔴🔴🔴🔴Erro ao enviar mensagem na sessão ${sessionId}:`, err);
        //throw err;
    }
}
// Função para enviar mensagem de mídia (imagem)
async function sendMedia(sessionId, recipientJid, media, caption) {
    const sock = clients.get(sessionId);
    if (!sock) {
        throw new Error(`Cliente WhatsApp para sessão ${sessionId} não está conectado.`);
    }
    try {
        const message = {
            image: media, // Pode ser { url: 'path/to/file' } ou Buffer
            caption: caption || ''
        };

        const sentMessage = await sock.sock.sendMessage(recipientJid, message);
        console.log(`Imagem enviada para ${recipientJid} na sessão ${sessionId}`);
        return sentMessage;
    } catch (err) {
        console.error(`Erro ao enviar imagem na sessão ${sessionId}:`, err);
        throw err;
    }
}
// NOVA: Função para enviar mensagem de áudio
async function sendAudio(sessionId, recipientJid, audioBuffer, mediaPath, mimetype, duration) {
    const sock = clients.get(sessionId);
    if (!sock) {
        
        throw new Error(`Cliente WhatsApp para sessão ${sessionId} não está conectado.`);
    }
    try {

        const oggBuffer = await convertMp4ToOggBuffer(mediaPath);
        // const message = {
        //     audio: { url: mediaPath, mimetype: mimetype, ptt:true}, // Usa a chave 'audio' com o caminho para o arquivo
        //     mimetype: mimetype,
        //     caption: '',
        //     ptt:true,
        //     seconds: 2
        // };

        const message = {
            audio: oggBuffer, // Usa a chave 'audio' com o caminho para o arquivo
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true,
            seconds: duration

        };


        const sentMessage = await sock.sock.sendMessage(recipientJid, message);
        console.log(`Áudio enviado para ${recipientJid} na sessão ${sessionId}`);
        return sentMessage;
    } catch (err) {
        console.error(`Erro ao enviar áudio na sessão ${sessionId}:`, err);
        throw err;
    }
}
async function sendDocument(sessionId, recipientJid, mediaPath, mimetype, fileName) {
    const sock = clients.get(sessionId);
    if (!sock) {
        throw new Error(`Cliente WhatsApp para sessão ${sessionId} não está conectado.`);
    }
    try {
        const message = {
            document: { url: mediaPath, mimetype: mimetype }, // Usa buffer diretamente
            mimetype: mimetype,
            fileName: fileName || 'documento' // Nome do arquivo exibido no WhatsApp
        };
        const sentMessage = await sock.sock.sendMessage(recipientJid, message);
        console.log(`Documento enviado para ${recipientJid} na sessão ${sessionId}`);
        return sentMessage;
    } catch (err) {
        console.error(`Erro ao enviar documento na sessão ${sessionId}:`, err);
        throw err;
    }
}

export function convertMp4ToOggBuffer(inputPath) {
    return new Promise((resolve, reject) => {
        const chunks = [];

        ffmpeg(inputPath)
            .audioCodec('libopus')
            .format('ogg')
            .audioChannels(1)
            .audioBitrate('48k')
            .on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve(buffer);
            })
            .on('error', reject)
            .writeToStream(new Writable({
                write(chunk, encoding, callback) {
                    chunks.push(chunk);
                    callback();
                }
            }));
    });
}

// Manipula conexões Socket.IO
io.on('connection', (socket) => {
    console.log(`✅ 🙋 Novo cliente Socket.IO conectado: ${socket.id}`);

    // Opcional: Permite que o cliente especifique uma sessionId para receber eventos específicos
    socket.on('joinSession', (sessionId) => {
        socket.join(sessionId); // Junta o cliente a uma sala específica por sessionId
        console.log(` 🙋 Cliente ${socket.id} juntou-se à sessão ${sessionId}`);
    });

    socket.on('disconnect', () => {
        console.log(`🙋 Cliente Socket.IO desconectado: ${socket.id}`);
    });

    socket.on('sendMessage', (message) => { 
        let sessionId = message.numerotelefone.toString()
        console.log(`[1;45m 🟣🟣🟣🟣🟣 index.js:588 'message'`, message, ' [0m ')
        sendMessage(sessionId, message.recipient_jid, message.message_content, message.idusuario)
    });

    socket.on('redownloadAudio', async ({ messageId }) => {

        const message = await dbService.getMessageById(messageId, 1)


        try {
            const audioMessage = JSON.parse(message[0].message_content).audioMessage;
            const fileName = `${Date.now()}-${message[0].id}.${audioMessage.mimetype.includes('ogg') ? 'ogg' : 'mp3'}`;
            const filePath = path.join(AUDIO_STORAGE_PATH, fileName);

            const fakeMessage = {
                key: { id: message[0].id, remoteJid: `${message[0].jid}` },
                message: { audioMessage: audioMessage },
            };


            const buffer = await downloadMediaMessage(fakeMessage, 'buffer', {}, {
                //   logger: sock.logger,
                //   reuploadRequest: sock.uploadMedia,
            });
            fs.writeFileSync(filePath, buffer);

            const updateMessage = {
                id: message[0].id,
                sessionId: message[0].session_id,
                message: message[0],
                type: 'audio',
                fileUrl: `${process.env.HOST}:${process.env.EXPRESS_PORT}/uploads/a/${fileName}`,
                mimetype: audioMessage.mimetype,
                duration: audioMessage.duration,
                timestamp: new Date(message[0].timestamp * 1000).toISOString(),
                isFromUser: false,
                fromApp: (!message.status) ? false : true,
                remoteJid: message[0].sender_jid
            }
            io.emit('updateMessage', updateMessage);
            console.log(`%c🟡🟡🟡🟡🟡 index.js:611 '' `, ' background-color:yellow; color: black; font-size: 16px;', updateMessage)


        } catch (error) {

        }


    });
    socket.on('redownloadImage', async ({ messageId }) => {

        const message = await dbService.getMessageById(messageId, 1)
        console.log(`%c${new Date().toLocaleTimeString()} index.js:476 'message' `, ' background-color:green; color: white; font-size: 16px;', message)

        try {
            const imageMessage = JSON.parse(message[0].message_content).imageMessage;
            const fileName = `${Date.now()}-${message[0].id}.${imageMessage.mimetype.includes('jpeg') ? 'jpg' : imageMessage.mimetype.includes('png') ? 'png' : 'jpg'}`;
            const filePath = path.join(MEDIA_STORAGE_PATH, fileName);

            const fakeMessage = {
                key: { id: message[0].id, remoteJid: `${message[0].jid}` },
                message: { imageMessage: imageMessage },
            };


            const buffer = await downloadMediaMessage(fakeMessage, 'buffer', {}, {
                //   logger: sock.logger,
                //   reuploadRequest: sock.uploadMedia,
            });
            fs.writeFileSync(filePath, buffer);
            io.emit('updateMessage', {
                id: message[0].id,
                sessionId: message[0].session_id,
                message: message[0],
                type: 'image',
                fileUrl: `${process.env.HOST}:${process.env.EXPRESS_PORT}/uploads/m/${fileName}`,
                mimetype: imageMessage.mimetype,
                duration: 0,
                timestamp: new Date(message[0].timestamp * 1000).toISOString(),
                isFromUser: false,
                fromApp: (!message.status) ? false : true,
                remoteJid: message[0].sender_jid

            });


        } catch (error) {

        }


    });
    socket.on('redownloadVideo', async ({ messageId }) => {

        const message = await dbService.getMessageById(messageId, 1)

        try {
            const videoMessage = JSON.parse(message[0].message_content).videoMessage;
            const fileName = `${Date.now()}-${message[0].id}.${videoMessage.mimetype.includes('mp4') ? 'mp4' : 'mkv'}`;
            const filePath = path.join(VIDEO_STORAGE_PATH, fileName);

            const fakeMessage = {
                key: { id: message[0].id, remoteJid: `${message[0].jid}` },
                message: { videoMessage: videoMessage },
            };


            const buffer = await downloadMediaMessage(fakeMessage, 'buffer', {}, {
                //   logger: sock.logger,
                //   reuploadRequest: sock.uploadMedia,
            });
            fs.writeFileSync(filePath, buffer);
            io.emit('updateMessage', {
                id: message[0].id,
                sessionId: message[0].session_id,
                message: message[0],
                type: 'video',
                fileUrl: `${process.env.HOST}:${process.env.EXPRESS_PORT}/uploads/v/${fileName}`,
                mimetype: videoMessage.mimetype,
                duration: 0,
                timestamp: new Date(message[0].timestamp * 1000).toISOString(),
                isFromUser: false,
                fromApp: (!message.status) ? false : true,
                remoteJid: message[0].sender_jid

            });


        } catch (error) {

        }


    });
    socket.on('redownloadDocument', async ({ messageId }) => {

        const message = await dbService.getMessageById(messageId, 1)
            
        try {
             
            //const documentMessage = message[0].message.documentMessage || message[0].message?.documentWithCaptionMessage.message.documentMessage;
             const documentMessage = JSON.parse(message[0].message_content).documentMessage || JSON.parse(message[0].message_content).documentWithCaptionMessage.message.documentMessage
            
            let fileExtension = 'bin';
            console.log(`%c🔴🔴🔴documentMessage.mimetype🔴🔴 index2.js:979 '' `, ' background-color:red; color: white; font-size: 16px;', documentMessage.mimetype)
            if (documentMessage.mimetype.includes('application/pdf')) {
                fileExtension = 'pdf';

            } else if (documentMessage.mimetype.includes('application/msword')) {
                fileExtension = 'doc';

            } else if (documentMessage.mimetype.includes('officedocument.wordprocessingml.document')) {
                fileExtension = 'docx';

            } else if (documentMessage.mimetype.includes('application/vnd.ms-excel')) {
                fileExtension = 'xls';

            } else if (documentMessage.mimetype.includes('officedocument.spreadsheetml.sheet')) {
                fileExtension = 'xlsx';

            } else if (documentMessage.mimetype.includes('text/csv')) {
                fileExtension = 'csv';

            } else if (documentMessage.mimetype.includes('text/plain')) {
                fileExtension = 'txt';

            } else if (documentMessage.mimetype.includes('application/vnd.ms-powerpoint')) {
                fileExtension = 'ppt';

            } else if (documentMessage.mimetype.includes('officedocument.presentationml.presentation')) {
                fileExtension = 'pptx';

            } else if (documentMessage.mimetype.includes('application/vnd.oasis.opendocument.text')) {
                fileExtension = 'odt';

            } else if (documentMessage.mimetype.includes('application/vnd.oasis.opendocument.spreadsheet')) {
                fileExtension = 'ods';

            } else if (documentMessage.mimetype.includes('application/rtf')) {
                fileExtension = 'rtf';

            } else if (documentMessage.mimetype.includes('application/json')) {
                fileExtension = 'json';

            } else if (documentMessage.mimetype.includes('application/xml') || documentMessage.mimetype.includes('text/xml')) {
                fileExtension = 'xml';

            } else if (documentMessage.mimetype.includes('application/zip')) {
                fileExtension = 'zip';

            } else {
                // fallback genérico
                fileExtension = 'bin';
            }

            const fileName = `${Date.now()}-${message[0].id}.${fileExtension}`;
            const filePath = path.join(DOCUMENT_STORAGE_PATH, fileName);

            const fakeMessage = {
                key: { id: message[0].id, remoteJid: `${message[0].jid}` },
                message: { documentMessage: documentMessage },
            };


            const buffer = await downloadMediaMessage(fakeMessage, 'buffer', {}, {
                //   logger: sock.logger,
                //   reuploadRequest: sock.uploadMedia,
            });
            fs.writeFileSync(filePath, buffer);

            const updateMessage = {
                id: message[0].id,
                sessionId: message[0].session_id,
                message: message[0],
                type: 'document',
                fileUrl: `${process.env.HOST}:${process.env.EXPRESS_PORT}/uploads/d/${fileName}`,
                mimetype: documentMessage.mimetype,
                duration: documentMessage.duration,
                timestamp: new Date(message[0].timestamp * 1000).toISOString(),
                isFromUser: false,
                fromApp: (!message.status) ? false : true,
                remoteJid: message[0].sender_jid
            }
            io.emit('updateMessage', updateMessage);
            console.log(`%c🟡🟡🟡🟡🟡 index.js:611 '' `, ' background-color:yellow; color: black; font-size: 16px;', updateMessage)


        } catch (error) {

        }
    });

});

// Endpoint para iniciar uma nova sessão
// Uma sessionID aleatoria deve ser gerada e enviada no request
app.post('/iniciarsessao', async (req, res) => {
    const { sessionId, idusuario, numerotelefone } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId é obrigatório' });
    }

    if (clients.has(sessionId)) {
        return res.status(400).json({ error: `Sessão ${sessionId} já está ativa` });
    }

    try {
        // AQUI RECEBE O ID DA SESSAO, ID DO USUARIO E O NUMERO DO TELEFONE DO WHATSAPP
        await connectToWhatsApp(sessionId, idusuario);
        res.status(200).json({ message: `Sessão ${sessionId} iniciada. Escaneie o QR Code em qrcode_${sessionId}.png` });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao iniciar sessão', details: err.message });
    }
});

// Endpoint para sessão armazenada em memoria
app.get('/sessoes/:idusuario', async (req, res) => {

    const { idusuario } = req.params;

    try {
        let sessoes = {}


        for (const [chave, valor] of clients.entries()) {
            let item = { sessionId: chave, user: {}, qrcode: {}, idusuario: null, numerotelefone: null };
            if(valor.idusuario)
            {
                if(valor.idusuario == idusuario)
                {
                    item.user = valor.sock.user || null;
                    item.idusuario = valor.idusuario || null;
                    item.numerotelefone = valor.numerotelefone || null;
                    //item.qrcode = valor.qrcode || null;
                    sessoes[chave] = item
                }

            }    

        }        

        res.status(200).json({ sessoes: sessoes });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao iniciar sessão', details: err.message });
    }
});

// Endpoint para buscar  o historico de sessoes do usuario armazenado em BD
app.get('/minhassessoes/:idusuario', async (req, res) => {

    const { idusuario } = req.params;

    try {
        let sessoes = {}

       sessoes = await dbService.getSession(idusuario)      
        res.status(200).json({ sessoes});
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar sessoes', details: err.message });
    }
});


app.get('/contatos/:idusuario', async (req, res) => {

    const { idusuario } = req.params;
    try {
        const contatos = await dbService.getContacts(idusuario)

        res.status(200).json(contatos);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao iniciar sessão', details: err.message });
    }
});

app.get('/conversas/:idusuario/:idcontato/:qtde', async (req, res) => {

    const { idusuario, idcontato, qtde } = req.params;

    try {
        const conversas = await dbService.getConversation(idusuario, idcontato, qtde)

        res.status(200).json(conversas);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao iniciar sessão', details: err.message });
    }
});

app.get('/uploads/:tipo/:filename', async (req, res) => {
    const { tipo, filename } = req.params;

    let caminho = ""
    let mimetype = ""
    if (tipo === 'v') {
        caminho = VIDEO_STORAGE_PATH;
        if (filename.endsWith('.mp4')) {
            mimetype = 'video/mp4';
        } else if (filename.endsWith('.avi')) {
            mimetype = 'video/x-msvideo';
        } else if (filename.endsWith('.mov')) {
            mimetype = 'video/quicktime';
        } else {
            mimetype = 'video/mp4';
        }
    } else if (tipo === 'a') {
        caminho = AUDIO_STORAGE_PATH;
        if (filename.endsWith('.ogg')) {
            mimetype = 'audio/ogg';
        } else if (filename.endsWith('.wav')) {
            mimetype = 'audio/wav';
        } else {
            mimetype = 'audio/mpeg';
        }
    } else if (tipo === 'd') {
        caminho = DOCUMENT_STORAGE_PATH;
        if (filename.endsWith('.pdf')) {
            mimetype = 'application/pdf';
        } else if (filename.endsWith('.doc') || filename.endsWith('.docx')) {
            mimetype = 'application/msword';
        } else if (filename.endsWith('.xls') || filename.endsWith('.xlsx')) {
            mimetype = 'application/vnd.ms-excel';
        } else if (filename.endsWith('.txt')) {
            mimetype = 'text/plain';
        } else if (filename.endsWith('.csv')) {
            mimetype = 'text/csv';
        } else {
            mimetype = 'application/octet-stream'; // fallback genérico
        }
    } else if (tipo === 'm') {
        caminho = MEDIA_STORAGE_PATH;
        if (filename.endsWith('.jpeg') || filename.endsWith('.jpg')) {
            mimetype = 'image/jpeg';
        } else if (filename.endsWith('.png')) {
            mimetype = 'image/png';
        } else if (filename.endsWith('.gif')) {
            mimetype = 'image/gif';
        } else {
            mimetype = 'image/jpeg';
        }
    }

    const filePath = path.join(caminho, req.path.split(`/uploads/${tipo}/`)[1]);

    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', mimetype);
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.status(404).send('File not found');
    }


});
// Endpoint para qrcode
app.get('/qrcode/:sessionId', async (req, res) => {

    const sessionId = req.params.sessionId;

    let cli = clients.get(sessionId)
    try {

        res.status(200).json({ qrcode: cli.qrcode });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao iniciar sessão', details: err.message });
    }
});

// Endpoint /sendmedia
app.post('/sendmedia/:idusuario', uploadImage.single('image'), async (req, res) => {
    console.log(`%c${new Date().toLocaleTimeString()} index.js:741 'req.body' `, ' background-color:green; color: white; font-size: 16px;', req.body)
    const { sessionId, recipientJid, caption, mediaUrl } = req.body;
     const { idusuario } = req.params;
    const file = req.file; // Arquivo enviado via multipart/form-data

    if (!sessionId || !recipientJid || !idusuario) {
        return res.status(400).json({ error: 'sessionId e recipientJid são obrigatórios' });
    }

    if (!file && !mediaUrl) {
        return res.status(400).json({ error: 'Imagem (file ou mediaUrl) é obrigatória' });
    }

    let media;
    let mediaFilename;

    try {
        if (file) {
            // Imagem enviada via upload
            mediaFilename = `${crypto.randomUUID()}-${file.originalname}`;
            const mediaPath = path.join(MEDIA_STORAGE_PATH, mediaFilename);
            await fspromises.rename(file.path, mediaPath); // Move do diretório temporário para media
            media = { url: mediaPath, mimetype: file.mimetype };
        } else {
            // Imagem via URL
            const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
            mediaFilename = `${crypto.randomUUID()}.${mediaUrl.split('.').pop()}`;
            const mediaPath = path.join(MEDIA_STORAGE_PATH, mediaFilename);
            await fspromises.writeFile(mediaPath, Buffer.from(response.data));
            media = { url: mediaPath, mimetype: response.headers['content-type'] };
        }

        const sentMessage = await sendMedia(sessionId, recipientJid, media, caption);
        if (sentMessage) {
            await dbService.saveMessage(sentMessage, sessionId, clients.get(sessionId));
            res.status(200).json({ message: 'Imagem enviada com sucesso', sentMessage });
        } else {
            res.status(500).json({ error: 'Falha ao enviar imagem' });
        }
    } catch (err) {
         io.emit('sessaoDesconectada', { sessionId, idusuario });   
        console.error(`Erro ao processar imagem para ${sessionId}:`, err);
        res.status(500).json({ error: 'Erro ao enviar imagem', details: err.message });
    }
});

app.post('/sendaudio/:idusuario', uploadAudio.single('audio'), async (req, res) => {

    // const { sessionId, recipientJid, idusuario, mediaUrl } = req.body;
    const { sessionId, recipientJid,  duration } = req.body;
     const { idusuario } = req.params;
    const file = req.file; // Arquivo enviado via multipart/form-data

    if (!sessionId || !recipientJid) {
        return res.status(400).json({ error: 'sessionId e recipientJid são obrigatórios' });
    }

    if (!file) {
        return res.status(400).json({ error: 'Um arquivo de áudio (campo "audio") ou uma mediaUrl é obrigatório' });
    }

    let mediaPath;
    let mediaFilename;
    let mimetype;

    try {
        if (file) {
            // Áudio enviado via upload
            // mediaPath = file.path; // Multer já salvou o arquivo, usamos o caminho dele
            // mimetype = file.mimetype;
            // Processa o arquivo de áudio
            mediaFilename = `${crypto.randomUUID()}-${file.originalname}`;
            mediaPath = path.join(AUDIO_STORAGE_PATH, mediaFilename);
            await fspromises.rename(file.path, mediaPath); // Move o arquivo para o diretório final           
            mimetype = file.mimetype === 'audio/ogg' ? 'audio/ogg; codecs=opus' : file.mimetype;

            // Lê o arquivo como buffer (recomendado pelo Baileys)
            const audioBuffer = await fspromises.readFile(mediaPath);


            const sentMessage = await sendAudio(sessionId, recipientJid, audioBuffer, mediaPath, mimetype, duration);


            if (sentMessage) {
                res.status(200).json({ message: 'Áudio enviado com sucesso', sentMessage });
            } else {
                res.status(500).json({ error: 'Falha ao enviar áudio' });
            }

           

        } else {
            // Áudio via URL
            // const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
            // const mediaFilename = `${crypto.randomUUID()}.${mediaUrl.split('.').pop()}`;
            // mediaPath = path.join(AUDIO_STORAGE_PATH, mediaFilename);
            // await fspromises.writeFile(mediaPath, Buffer.from(response.data));
            // mimetype = response.headers['content-type'];
        }

    } catch (err) {    
        io.emit('sessaoDesconectada', { sessionId, idusuario });    
        console.error(`Erro ao processar áudio para ${sessionId}:`, err);
        res.status(500).json({ error: 'Erro ao enviar áudio', details: err.message });
    }
});

app.post('/sendvideo/:idusuario', uploadVideo.single('video'), async (req, res) => {

    // const { sessionId, recipientJid, idusuario, mediaUrl } = req.body;
    const { sessionId, recipientJid, duration } = req.body;
    const { idusuario } = req.params;
    const file = req.file; // Arquivo enviado via multipart/form-data

    if (!sessionId || !recipientJid) {
        return res.status(400).json({ error: 'sessionId e recipientJid são obrigatórios' });
    }

    if (!file) {
        return res.status(400).json({ error: 'Um arquivo de áudio (campo "audio") ou uma mediaUrl é obrigatório' });
    }

    let mediaPath;
    let mediaFilename;
    let mimetype;

    try {
        if (file) {
            // Áudio enviado via upload
            // mediaPath = file.path; // Multer já salvou o arquivo, usamos o caminho dele
            // mimetype = file.mimetype;
            // Processa o arquivo de áudio
            mediaFilename = `${crypto.randomUUID()}-${file.originalname}`;
            mediaPath = path.join(VIDEO_STORAGE_PATH, mediaFilename);
            await fspromises.rename(file.path, mediaPath); // Move o arquivo para o diretório final           
            mimetype = file.mimetype === 'audio/ogg' ? 'audio/ogg; codecs=opus' : file.mimetype;

            // Lê o arquivo como buffer (recomendado pelo Baileys)
            const audioBuffer = await fspromises.readFile(mediaPath);

            
            const sentMessage = await sendAudio(sessionId, recipientJid, audioBuffer, mediaPath, mimetype, duration);


            if (sentMessage) {
                res.status(200).json({ message: 'Vídeo enviado com sucesso', sentMessage });
            } else {
                res.status(500).json({ error: 'Falha ao enviar vídeo' });
            }

        } else {
            // Áudio via URL
            // const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
            // const mediaFilename = `${crypto.randomUUID()}.${mediaUrl.split('.').pop()}`;
            // mediaPath = path.join(AUDIO_STORAGE_PATH, mediaFilename);
            // await fspromises.writeFile(mediaPath, Buffer.from(response.data));
            // mimetype = response.headers['content-type'];
        }

      
    } catch (err) {
        console.error(`Erro ao processar vídeo para ${sessionId}:`, err);
        res.status(500).json({ error: 'Erro ao enviar vídeo', details: err.message });
    }
});
// Endpoint /senddocument
app.post('/senddocument/:idusuario', uploadDocument, async (req, res) => {
    const { sessionId, recipientJid } = req.body;
    const { idusuario } = req.params;
    const file = req.file; // Arquivo enviado via multipart/form-data

    // Validação dos parâmetros
    if (!sessionId || !recipientJid) {
        return res.status(400).json({ error: 'sessionId e recipientJid são obrigatórios' });
    }

    if (!file) {
        return res.status(400).json({ error: 'Um arquivo de documento (campo "document") é obrigatório' });
    }

    let mediaPath;
    let mediaFilename;
    let mimetype;

    try {
        // Processa o arquivo de documento
        mediaFilename = `${crypto.randomUUID()}-${file.originalname}`;
        mediaPath = path.join(DOCUMENT_STORAGE_PATH, mediaFilename);
        await fspromises.rename(file.path, mediaPath); // Move o arquivo para o diretório final
        mimetype = file.mimetype;

        // Lê o arquivo como buffer (recomendado pelo Baileys)
        //const documentBuffer = await fspromises.readFile(mediaPath);

        // Envia o documento
        const sentMessage = await sendDocument(sessionId, recipientJid, mediaPath, mimetype, file.originalname);

        // Salva a mensagem no banco de dados
        if (sentMessage) {
            res.status(200).json({ message: 'Documento enviado com sucesso', sentMessage });
        } else {
            res.status(500).json({ error: 'Falha ao enviar documento' });
        }
    } catch (err) {
        io.emit('sessaoDesconectada', { sessionId, idusuario });  
        console.error(`Erro ao processar documento para ${sessionId}:`, err);
        res.status(500).json({ error: 'Erro ao enviar documento', details: err.message });
    } finally {
        // Limpa o arquivo temporário, se ainda existir
        if (file && file.path) {
            await fs.unlink(file.path).catch(err => console.warn('Erro ao limpar arquivo temporário:', err));
        }
    }
});

app.put('/updatecontato/:id/:idusuario', uploadDocument, async (req, res) => {
    const { sessionId, alias } = req.body;
    const { id, idusuario } = req.params;
    
    // Validação dos parâmetros
    if (!sessionId || !id) {
        return res.status(400).json({ error: 'sessionId e id do contato são obrigatórios' });
    }

    try {

        await dbService.updateContactAlias(id, alias, idusuario);
        res.status(200).json({ message: 'Contato atualizado com sucesso' });

    } catch (err) {
        console.error(`Erro ao processar documento para ${sessionId}:`, err);
        res.status(500).json({ error: 'Erro ao atualizar contato', details: err.message });
    }
});

// Inicia o servidor Express
appserver.listen(port, () => {
    console.log(`✅ Servidor Express rodando na porta ${port}`);
    
});

// Inicia o servidor Express
serversocket.listen(sockeioport, () => {
    console.log(`✅ Servidor SOCKET rodando na porta ${sockeioport}`);
});
// // Inicia o servidor Http
// httpServer.listen(3002, () => {
//     console.log(`Servidor HTTP rodando na porta ${3002}`);
// });

// Inicia a conexão com o WhatsApp
//connectToWhatsApp('dault',1).catch((err) => console.error('Erro na inicialização:', err));
startSession('default', 1);
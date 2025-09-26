import mysql from 'mysql2/promise';
import { dbConfig } from '../config/db.config.js';


class DatabaseService {
  async connect() {
    return await mysql.createConnection(dbConfig);
  }

  async saveMessage(message, sessionId, client) {

    const db = await this.connect();
    try {
      const { key, message: msg, messageTimestamp } = message;
      if (!key || !key.id || !key.remoteJid || !msg) return {dados: {}, status: 400, motivo: 'Parâmetros inválidos'};

      const [existing] = await db.execute(
        'SELECT message_id FROM conversas WHERE message_id = ? AND session_id = ?',
        [key.id, sessionId]
      );
      if (existing.length > 0) return {dados: {}, status: 404, motivo: 'Mensagem já existe'};

      const oneDayAgo = Date.now() - 96 * 60 * 60 * 1000;
      const timestamp = messageTimestamp ? Number(messageTimestamp) * 1000 : Date.now();
      if (timestamp < oneDayAgo) return {dados: {}, status: 300, motivo: 'Mensagem muito antiga'};

      const senderJid = key.fromMe ? 'me' : key.remoteJid;
      const recipientJid = key.fromMe ? key.remoteJid : 'me';
      const messageContent = msg.text || msg.conversation || msg.extendedTextMessage?.text || JSON.stringify(msg);
      const messageType = Object.keys(msg)[0] || 'unknown';
      await db.execute(
        'INSERT INTO conversas (message_id, sender_jid, recipient_jid, message_content, message_type, timestamp, session_id, numerotelefone, jid, idusuario) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          key.id,
          senderJid,
          recipientJid,
          messageContent,
          messageType,
          timestamp,
          sessionId,
          client.sock.user.id.split(':')[0],
          client.sock.user.id,
          client.idusuario,
        ]
      );

      if (senderJid.includes('@s.whatsapp.net')) {
        
        return {
          dados: {
          contato: senderJid,
          numerotelefone: client.sock.user.id.split(':')[0],
          jid: client.sock.user.id,
          idusuario: client.idusuario,
        }, 
        status: 200,
        motivo: 'Mensagem de contato individual inserida com sucesso'}
      }
      else {
        return senderJid.includes('@g.us') ? {dados: {}, status: 201, motivo: 'Mensagem de grupo'} : {dados: {}, status: 202, motivo: 'Mensagem de broadcast'};
      }
    } catch (err) {
      console.error(`Erro ao salvar mensagem para ${sessionId}:`, err);
    } finally {
      // Release the connection back to the pool
      if (db) {
        db.end();
      }
    }

    return  {dados: {}, status: 203, motivo: 'Nao inserido, sem erro'}
  }

  async saveContact(contato) {
    const db = await this.connect();
    console.log(`[1;45m 🟣🟣🟣🟣🟣 DatabaseService.js:74 'contato'`, contato, ' [0m ')
    try {
      const timestamp = Date.now();
      // VERIFICA SE O CONTATO JA EXISTE PARA O USUARIO E NUMERO DE TELEFONE
      const [existing] = await db.execute(
        'SELECT id FROM contatos WHERE contato = ? AND idusuario = ? AND numerotelefone = ?',
        [contato.contato, contato.idusuario, contato.numerotelefone]
      );

      if (existing.length > 0) {
        await db.execute(
          'UPDATE contatos SET ts = ? WHERE contato = ? AND idusuario = ? AND numerotelefone = ?',
          [timestamp, contato.contato, contato.idusuario, contato.numerotelefone]
        );
        return null;
      }

      const [result] = await db.execute(
        'INSERT INTO contatos (contato, idusuario, numerotelefone, jid, ts) VALUES (?, ?, ?, ?, ?)',
        [contato.contato, contato.idusuario, contato.numerotelefone, contato.jid, timestamp]
      );
      return result.insertId;
    } catch (err) {
      console.log(`%c🔴🔴🔴🔴🔴 DatabaseService.js:93 'contato' `,' background-color:red; color: white; font-size: 16px;', contato)
      console.error(`Erro ao salvar contato para ${contato.idusuario}:`, err);
    }
    finally {   
        if (db) {
            db.end();           
        }
    }
  }

  async getContacts(idusuario) {
    const db = await this.connect();
    try {
      const [contacts] = await db.execute(
        'SELECT *, false as notificar, ts FROM contatos WHERE idusuario = ? ORDER BY ts DESC',
        [idusuario]
      );
      return contacts;
    } finally {
      await db.end();
    }
  }

  async getConversation(idusuario, idcontato, qtde = 50) {
    const db = await this.connect();
    try {
      const [messages] = await db.execute(
        `SELECT * FROM conversas
         WHERE idusuario = ? AND (
           (recipient_jid = ? AND sender_jid = 'me') OR
           (sender_jid = ? AND recipient_jid = 'me')
         ) ORDER BY timestamp DESC LIMIT ?`,
        [idusuario, idcontato, idcontato, qtde]
      );
      return messages;
    } finally {
      await db.end();
    }
  }

  async getMessageById(messageId, idusuario) {
    const db = await this.connect();
    try {
      const [message] = await db.execute(
        'SELECT * FROM conversas WHERE idusuario = ? AND id = ?',
        [idusuario, messageId]
      );
      return message;
    } finally {
      await db.end();
    }
  }

  async updateContactAlias(id, alias, idusuario) {
    const db = await this.connect();
    try {
      await db.execute(
        'UPDATE contatos SET alias = ? WHERE id = ? and idusuario = ? ',
        [alias, id, idusuario]
      );

    } catch (err) {
      console.error(`Erro updateContactAlias:`, err);
    }
    finally {        
        if (db) {
            db.end();           
        }
    }
  }

  async saveSession(sessao) {
    const db = await this.connect();
    console.log(`[1;45m 🟣🟣🟣🟣🟣 DatabaseService.js:172 'sessao'`, sessao, ' [0m ')
    try {
          
      const [existing] = await db.execute(
        'SELECT id FROM sessoes WHERE idusuario = ? AND numerotelefone = ?',
        [sessao.idusuario, sessao.phoneNumber]
      );

      if (existing.length > 0) {       
        return null;
      }

      const [result] = await db.execute(
        'INSERT INTO sessoes (idusuario, numerotelefone, sessionid) VALUES (?, ?, ?)',
        [sessao.idusuario, sessao.phoneNumber, sessao.sessionId]
      );
      return result.insertId;
    } catch (err) {
      console.log(`%c🔴🔴🔴🔴🔴 DatabaseService.js:190 'sessao' `,' background-color:red; color: white; font-size: 16px;', sessao)
      console.error(`Erro ao salvar sessao para ${sessao}:`, err);
    }
    finally {   
        if (db) {
            db.end();           
        }
    }
  }

 async getSession(idusuario) {
    const db = await this.connect();
    try {
      const [sess] = await db.execute(
        'SELECT * FROM sessoes WHERE idusuario = ?',
        [idusuario]
      );      
      return sess;
    } finally {
      await db.end();
    }
  }
}

export default DatabaseService;
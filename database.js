import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabase('fast_azzurro_v2.db');

export const initDatabase = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      // 1. IMPOSTAZIONI GLOBALI AMMINISTRATORE E BRANDING
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS Settings_App (
          chiave TEXT PRIMARY KEY,
          valore TEXT NOT NULL
        )`
      );
      
      const defaultSettings = [
        ['app_name', 'Fast_azzurro97'],
        ['app_motto', 'Il tuo passaggio Elite'],
        ['app_logo', ''],
        ['bg_image', ''],
        ['admin_whatsapp', '+390000000000'],
        ['admin_email', 'creator.azzurro@gmail.com'], // TUA EMAIL
        ['admin_password', 'Azzurro97'],           // TUA PASS DEFAULT
        ['master_connection_secret', 'Azzurro97_Master'], // SEGRETO TECNICO
        ['sede_base', 'Molteno'],
        ['tariffa_minima', '7.00'],
        ['tariffa_diurna', '0.25'],
        ['tariffa_notturna', '0.40'],
        ['extra_passeggero', '2.50'],
        ['extra_bagaglio', '1.50'],
        ['metodi_pagamento', '{"contanti":true, "link_online":true, "pos":false, "bonifico":false}']
      ];
      defaultSettings.forEach(([k, v]) => {
        tx.executeSql(`INSERT OR IGNORE INTO Settings_App (chiave, valore) VALUES (?, ?)`, [k, String(v)]);
      });

      // 2. LA FABBRICA DELLE MICRO-IMPRESE (Autisti)
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS Autisti_Flotta (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL,
          telefono TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE,
          password TEXT NOT NULL,
          pin_accesso TEXT, 
          veicolo_modello TEXT NOT NULL,
          lat_casa REAL NOT NULL,
          lon_casa REAL NOT NULL,
          raggio_max_km REAL NOT NULL,
          is_ztl_enabled INTEGER DEFAULT 0,
          corsa_minima REAL DEFAULT 15.0,
          tariffa_diurna REAL DEFAULT 0.25,
          tariffa_notturna REAL DEFAULT 0.40,
          minimo_aereo REAL DEFAULT 30.0,
          quota_urgenza REAL DEFAULT 10.0,
          ricarico_serata_perc REAL DEFAULT 20.0,
          pax_aero_fisso REAL DEFAULT 15.0,
          pax_standard_scaglioni TEXT DEFAULT '{"2": 10, "3": 15, "4": 20}',
          bagaglio_fisso REAL DEFAULT 3.0,
          is_online INTEGER DEFAULT 0,
          reset_required INTEGER DEFAULT 0
        )`
      );

      // Autista Master per testare il sistema
      tx.executeSql(`INSERT OR IGNORE INTO Autisti_Flotta (id, nome, telefono, email, password, veicolo_modello, lat_casa, lon_casa, raggio_max_km, is_ztl_enabled) 
        VALUES (1, 'Admin Master', '+393274723787', 'driver@azzurro.it', 'Azzurro97', 'Hub Navicella', 45.7670, 9.3090, 1000, 1)`);

      // 3. TABELLA CLIENTI REGISTRATI (NEW)
      tx.executeSql(
         `CREATE TABLE IF NOT EXISTS Clienti_Registrati (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            telefono TEXT,
            reset_required INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
         )`
      );

      // 3. CALENDARIO, TURNI E FERIE
      tx.executeSql(
         `CREATE TABLE IF NOT EXISTS Calendario_Turni (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           id_autista INTEGER,
           data_formato TEXT NOT NULL, 
           ora_inizio TEXT, 
           ora_fine TEXT,
           is_chiusura_globale INTEGER DEFAULT 0,
           FOREIGN KEY (id_autista) REFERENCES Autisti_Flotta (id)
         )`
      );

      // 4. CORSE E GESTIONALE PRENOTAZIONI FINALI
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS Registro_Corse (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_id TEXT UNIQUE NOT NULL,
          cliente_nome TEXT NOT NULL,
          cliente_telefono TEXT NOT NULL,
          cliente_email TEXT, -- NEW: Per lo storico personale Titanium
          tipo_servizio TEXT NOT NULL, 
          is_andata_ritorno INTEGER DEFAULT 0,
          direzione_aeroporto TEXT,
          numero_volo TEXT,
          partenza_indirizzo TEXT NOT NULL,
          partenza_lat REAL,
          partenza_lon REAL,
          destinazione_indirizzo TEXT,
          destinazione_lat REAL,
          destinazione_lon REAL,
          tappe_intermedie TEXT, 
          passeggeri INTEGER NOT NULL,
          bagagli INTEGER NOT NULL,
          data_partenza TEXT NOT NULL,
          ora_partenza TEXT NOT NULL,
          note_cliente TEXT,
          km_calcolati REAL,
          preventivo_accettato REAL,
          id_autista_assegnato INTEGER,
          stato_corsa TEXT DEFAULT 'CODA', 
          prezzo_incasso_reale REAL,
          FOREIGN KEY (id_autista_assegnato) REFERENCES Autisti_Flotta (id)
        )`
      );
      // stati_corsa nel Driver App: CODA, AVVICINAMENTO, ARRIVATO, INIZIO, FINE
      // 5. CHAT GLOBALE GUEST (Persistenza 3 Giorni)
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS Chat_Globale (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          utente TEXT NOT NULL,
          messaggio TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      );
      // 6. LOG DI SISTEMA PER ADMIN
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS Audit_Logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          evento TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      );
    }, 
    (error) => { console.error("❌ Errore SQLite Core:", error); reject(error); },
    () => { 
        console.log("✅ Database SaaS Inizializzato Correttamente!"); 
        // Auto-Pulizia messaggi vecchi di 3 giorni
        pulisciVecchiaChat();
        resolve(); 
    }
    );
  });
};

// ===================================
// MOTORE CRUD SQLITE (Promise based)
// ===================================

export const getAutisti = () => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `SELECT * FROM Autisti_Flotta`,
                [],
                (_, { rows }) => {
                    let autisti = [];
                    for(let i=0; i<rows.length; i++) autisti.push(rows.item(i));
                    // Parse the JSON string
                    autisti = autisti.map(a => ({...a, pax_standard_scaglioni: JSON.parse(a.pax_standard_scaglioni || '{}') }));
                    resolve(autisti);
                },
                (_, error) => { reject(error); return false; }
            )
        });
    });
};

export const salvaTariffeAutista = (autista) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `UPDATE Autisti_Flotta SET 
                 nome=?, pin_accesso=?, raggio_max_km=?, is_ztl_enabled=?, 
                 corsa_minima=?, tariffa_diurna=?, tariffa_notturna=?, 
                 minimo_aereo=?, quota_urgenza=?, ricarico_serata_perc=?, 
                 pax_aero_fisso=?, pax_standard_scaglioni=?, bagaglio_fisso=?
                 WHERE id=?`,
                [
                    autista.nome, autista.pin_accesso, autista.raggio_max_km, autista.is_ztl_enabled,
                    autista.corsa_minima, autista.tariffa_diurna, autista.tariffa_notturna,
                    autista.minimo_aereo, autista.quota_urgenza, autista.ricarico_serata_perc,
                    autista.pax_aero_fisso, JSON.stringify(autista.pax_standard_scaglioni), autista.bagaglio_fisso,
                    autista.id
                ],
                () => {
                    tx.executeSql(`INSERT INTO Audit_Logs (evento) VALUES (?)`, [`⚙️ Tariffe e Regole di ${autista.nome} aggiornate dall'Admin.`]);
                    resolve();
                },
                (_, err) => reject(err)
            )
        })
    })
};

export const getAppSettings = () => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(`SELECT * FROM Settings_App`, [], (_, {rows}) => {
                let s = {};
                for(let i=0; i<rows.length; i++) s[rows.item(i).chiave] = rows.item(i).valore;
                resolve(s);
            }, (_, err) => reject(err))
        })
    });
};

export const updateAppSetting = (k, v) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(`UPDATE Settings_App SET valore=? WHERE chiave=?`, [String(v), k], () => {
                tx.executeSql(`INSERT INTO Audit_Logs (evento) VALUES (?)`, [`🛠️ Impostazione Globale [${k}] cambiata in: ${v}`]);
                resolve();
            }, (_, err) => reject(err))
        })
    });
};

export const salvaNuovaCorsa = (c) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `INSERT INTO Registro_Corse (
                    ticket_id, cliente_nome, cliente_telefono, tipo_servizio,
                    partenza_indirizzo, partenza_lat, partenza_lon, 
                    destinazione_indirizzo, destinazione_lat, destinazione_lon,
                    passeggeri, bagagli, data_partenza, ora_partenza, 
                    km_calcolati, preventivo_accettato, id_autista_assegnato
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    c.ticket_id, c.cliente_nome, c.cliente_telefono, c.tipo_servizio,
                    c.partenza_obj.address, c.partenza_obj.lat, c.partenza_obj.lon,
                    c.destinazione_obj?.address || c.aeroportoScelto || '', c.destinazione_obj?.lat || 0, c.destinazione_obj?.lon || 0,
                    c.passeggeri, c.bagagli, c.data_partenza, c.ora_partenza,
                    c.km_calcolati, c.preventivo_accettato, c.id_autista_assegnato
                ],
                () => {
                    tx.executeSql(`INSERT INTO Audit_Logs (evento) VALUES (?)`, [`🚗 Nuova Prenotazione Generata: ${c.ticket_id} (${c.cliente_nome})`]);
                    resolve();
                },
                (_, err) => reject(err)
            )
        })
    });
};

export const getCorsaByTicket = (ticket_id) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(`
                SELECT c.*, a.nome as driver_nome, a.veicolo_modello as driver_auto 
                FROM Registro_Corse c 
                LEFT JOIN Autisti_Flotta a ON c.id_autista_assegnato = a.id 
                WHERE c.ticket_id=?`, 
                [ticket_id], 
                (_, {rows}) => resolve(rows.length > 0 ? rows.item(0) : null), 
                (_, err) => reject(err)
            )
        })
    });
};

export const getRides = () => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(`
                SELECT c.*, a.nome as driver_nome, a.veicolo_modello as driver_auto 
                FROM Registro_Corse c 
                LEFT JOIN Autisti_Flotta a ON c.id_autista_assegnato = a.id 
                ORDER BY c.data_partenza DESC, c.ora_partenza DESC`, 
                [], 
                (_, {rows}) => {
                    let r = [];
                    for(let i=0; i<rows.length; i++) r.push(rows.item(i));
                    resolve(r);
                }, 
                (_, err) => reject(err)
            )
        })
    });
};

export const deleteRide = (rideId) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(`DELETE FROM Registro_Corse WHERE id=? OR ticket_id=?`, [rideId, String(rideId)], () => resolve(), (_, err) => reject(err))
        })
    });
};

export const eliminaAutista = (id) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(`DELETE FROM Autisti_Flotta WHERE id=?`, [id], () => {
                tx.executeSql(`INSERT INTO Audit_Logs (evento) VALUES (?)`, [`🗑️ Autista ID ${id} eliminato dalla flotta.`]);
                resolve();
            }, (_, err) => reject(err))
        })
    });
};

export const aggiungiAutista = (d) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `INSERT INTO Autisti_Flotta (nome, telefono, pin_accesso, veicolo_modello, lat_casa, lon_casa, raggio_max_km) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [d.nome, d.telefono, d.pin_accesso, d.veicolo_modello, 45.767, 9.309, 50],
                () => {
                    tx.executeSql(`INSERT INTO Audit_Logs (evento) VALUES (?)`, [`🚘 Nuovo Autista Assunto: ${d.nome}`]);
                    resolve();
                },
                (_, err) => reject(err)
            )
        })
    });
};

export const getAuditLogs = () => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(`SELECT * FROM Audit_Logs ORDER BY timestamp DESC LIMIT 50`, [], (_, {rows}) => {
                let r = [];
                for(let i=0; i<rows.length; i++) r.push(rows.item(i));
                resolve(r);
            }, (_, err) => reject(err))
        })
    });
};

export const registraEvento = (msg) => {
    db.transaction(tx => tx.executeSql(`INSERT INTO Audit_Logs (evento) VALUES (?)`, [msg]));
};

export const aggiornaStatoCorsa = (ticket_id, nuovo_stato) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `UPDATE Registro_Corse SET stato_corsa=? WHERE ticket_id=?`,
                [nuovo_stato, ticket_id],
                () => resolve(),
                (_, err) => reject(err)
            )
        })
    })
};

export const getCorseDriver = (id_autista) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(`SELECT * FROM Registro_Corse WHERE id_autista_assegnato=? ORDER BY data_partenza, ora_partenza`, [id_autista], 
            (_, {rows}) => {
                let r = [];
                for(let i=0; i<rows.length; i++) r.push(rows.item(i));
                resolve(r);
            }, 
            (_, err) => reject(err))
        })
    });
};

// ===================================
// GESTIONE CHAT GLOBALE
// ===================================

export const inviaMessaggioChat = (utente, messaggio) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `INSERT INTO Chat_Globale (utente, messaggio) VALUES (?, ?)`,
                [utente, messaggio],
                () => resolve(),
                (_, err) => reject(err)
            )
        })
    });
};

export const getMessaggiChat = () => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `SELECT * FROM Chat_Globale ORDER BY timestamp ASC`,
                [],
                (_, { rows }) => {
                    let msgs = [];
                    for(let i=0; i<rows.length; i++) msgs.push(rows.item(i));
                    resolve(msgs);
                },
                (_, err) => reject(err)
            )
        })
    });
};

export const resetChatGlobale = () => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(`DELETE FROM Chat_Globale`, [], () => resolve(), (_, err) => reject(err))
        })
    });
};

export const pulisciVecchiaChat = () => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            // Elimina messaggi più vecchi di 3 giorni
            tx.executeSql(
                `DELETE FROM Chat_Globale WHERE timestamp < datetime('now', '-3 days')`,
                [],
                () => { 
                    console.log("🧹 Pulizia Chat Completata (Legacy 3 Giorni)"); 
                    // PULIZIA AUDIT LOGS (7 GIORNI)
                    tx.executeSql(
                        `DELETE FROM Audit_Logs WHERE timestamp < datetime('now', '-7 days')`,
                        [],
                        () => { console.log("🧹 Pulizia Audit Logs Completata (Legacy 7 Giorni)"); resolve(); }
                    );
                },
                (_, err) => reject(err)
            )
        })
    });
};

// ===================================
// SISTEMA DI AUTENTICAZIONE TITANIUM
// ===================================

export const verifyAdmin = (email, password) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `SELECT valore FROM Settings_App WHERE chiave='admin_email' OR chiave='admin_password'`,
                [],
                (_, { rows }) => {
                    let settings = {};
                    for(let i=0; i<rows.length; i++) {
                        const item = rows.item(i);
                        // Nota: questo query è un po' generica, meglio filtrata
                    }
                    // Metodo più sicuro
                    tx.executeSql(`SELECT valore FROM Settings_App WHERE chiave='admin_email'`, [], (_, resEmail) => {
                        const dbEmail = resEmail.rows.item(0)?.valore;
                        tx.executeSql(`SELECT valore FROM Settings_App WHERE chiave='admin_password'`, [], (_, resPass) => {
                            const dbPass = resPass.rows.item(0)?.valore;
                            if (email === dbEmail && password === dbPass) {
                                resolve({ success: true });
                            } else {
                                resolve({ success: false, message: "Credenziali Admin Errate" });
                            }
                        });
                    });
                },
                (_, err) => reject(err)
            )
        })
    });
};

export const verifyDriver = (identifier, passOrPin) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `SELECT * FROM Autisti_Flotta WHERE email=? OR telefono=?`,
                [identifier, identifier],
                (_, { rows }) => {
                    if (rows.length > 0) {
                        const driver = rows.item(0);
                        if (driver.password === passOrPin || driver.pin_accesso === passOrPin) {
                            resolve({ success: true, driver: { id: driver.id, nome: driver.nome, reset_required: driver.reset_required } });
                        } else {
                            resolve({ success: false, message: "Password o PIN errato" });
                        }
                    } else {
                        resolve({ success: false, message: "Driver non trovato" });
                    }
                },
                (_, err) => reject(err)
            )
        })
    });
};

export const registerCustomer = (nome, email, password, telefono) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `INSERT INTO Clienti_Registrati (nome, email, password, telefono) VALUES (?, ?, ?, ?)`,
                [nome, email, password, telefono],
                () => {
                    registraEvento(`👤 Nuovo Cliente Registrato: ${nome} (${email})`);
                    resolve({ success: true });
                },
                (_, err) => reject(err)
            )
        })
    });
};

export const verifyCustomer = (email, password) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `SELECT * FROM Clienti_Registrati WHERE email=?`,
                [email],
                (_, { rows }) => {
                    if (rows.length > 0) {
                        const client = rows.item(0);
                        if (client.password === password) {
                            resolve({ success: true, customer: { id: client.id, nome: client.nome, email: client.email, reset_required: client.reset_required } });
                        } else {
                            resolve({ success: false, message: "Password errata" });
                        }
                    } else {
                        resolve({ success: false, message: "Cliente non trovato" });
                    }
                },
                (_, err) => reject(err)
            )
        })
    });
};

export const getAllUsers = () => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(`SELECT id, nome, email, 'DRIVER' as type FROM Autisti_Flotta`, [], (_, drivers) => {
                tx.executeSql(`SELECT id, nome, email, 'CUSTOMER' as type FROM Clienti_Registrati`, [], (_, customers) => {
                    let all = [];
                    for(let i=0; i<drivers.rows.length; i++) all.push(drivers.rows.item(i));
                    for(let i=0; i<customers.rows.length; i++) all.push(customers.rows.item(i));
                    resolve({ success: true, users: all });
                });
            }, (_, err) => reject(err));
        });
    });
};

export const resetAdminPassword = (newPass) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `UPDATE Settings_App SET valore=? WHERE chiave='admin_password'`,
                [newPass],
                () => {
                    registraEvento(`🔑 Password Admin resettata dal pannello Master.`);
                    resolve({ success: true });
                },
                (_, err) => reject(err)
            )
        })
    });
};

export const resetUserPassword = (type, id, tempPass) => {
    const table = type === 'DRIVER' ? 'Autisti_Flotta' : 'Clienti_Registrati';
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `UPDATE ${table} SET password=?, reset_required=1 WHERE id=?`,
                [tempPass, id],
                () => {
                    registraEvento(`🔑 Reset Password ${type} (ID: ${id}) -> ${tempPass}`);
                    resolve({ success: true });
                },
                (_, err) => reject(err)
            )
        })
    });
};

export const updatePassword = (type, id, newPass) => {
    const table = type === 'DRIVER' ? 'Autisti_Flotta' : 'Clienti_Registrati';
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `UPDATE ${table} SET password=?, reset_required=0 WHERE id=?`,
                [newPass, id],
                () => {
                    registraEvento(`✅ Password Aggiornata per ${type} ID: ${id}`);
                    resolve({ success: true });
                },
                (_, err) => reject(err)
            )
        })
    });
};

export const getCustomerBookings = (email) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(
                `SELECT c.*, a.nome as driver_nome, a.veicolo_modello as driver_auto 
                 FROM Registro_Corse c 
                 LEFT JOIN Autisti_Flotta a ON c.id_autista_assegnato = a.id 
                 WHERE c.cliente_email=? 
                 ORDER BY c.data_partenza DESC, c.ora_partenza DESC`,
                [email],
                (_, { rows }) => {
                    let bookings = [];
                    for(let i=0; i<rows.length; i++) bookings.push(rows.item(i));
                    resolve({ success: true, bookings });
                },
                (_, err) => reject(err)
            )
        })
    });
};

export const loginUser = async (identifier, password, type) => {
    if (type === 'ADMIN') return await verifyAdmin(identifier, password);
    if (type === 'DRIVER') return await verifyDriver(identifier, password);
    if (type === 'CUSTOMER') return await verifyCustomer(identifier, password);
    return { success: false, message: 'Ruolo non valido' };
};

export const registerUser = async (nome, email, password, telefono, type) => {
    if (type === 'CUSTOMER') return await registerCustomer(nome, email, password, telefono);
    return { success: false, message: 'Ruolo non supportato' };
};

export const updateUserPassword = async (id, newPass, type = 'CUSTOMER') => {
    return await updatePassword(type, id, newPass); 
};

export const toggleDriverApproval = (id, status) => {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(`UPDATE Autisti_Flotta SET is_online=? WHERE id=?`, [status ? 1 : 0, id], () => resolve(), (_, err) => reject(err))
        })
    });
};

export const revokeDriver = (id) => {
    return eliminaAutista(id);
};

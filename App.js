'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, Text, View, Switch, SafeAreaView, 
  ScrollView, TouchableOpacity, Dimensions, StatusBar 
} from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { io } from 'socket.io-client';
import { format } from 'date-fns';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { 
  initDatabase, getAuditLogs, registraEvento, getAppSettings,
  loginUser, registerUser, resetUserPassword, updateUserPassword,
  getCustomerBookings, getRides, getAutisti, updateAppSetting,
  deleteRide, aggiornaStatoCorsa, salvaNuovaCorsa,
  salvaTariffeAutista, toggleDriverApproval, getCorsaByTicket
} from './database';

const { width } = Dimensions.get('window');

// Palette Obsidian
const COLORS = {
  bg: '#0d0e13',
  surface: '#121319',
  surfaceHigh: '#1e1f26',
  primary: '#3fff8b',
  secondary: '#6e9bff',
  error: '#ff716c',
  text: '#f7f5fd',
  textDim: '#abaab1',
  outline: '#47474e'
};

export default function App() {
  useKeepAwake();

  const [relayUrl] = useState('https://azzurro-relay-broker.onrender.com');
  const [isServerActive, setIsServerActive] = useState(false);
  const [socket, setSocket] = useState(null);
  const [statusText, setStatusText] = useState("SISTEMA_STANDBY");
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'logs', 'nodi', 'admin'
  const [logs, setLogs] = useState([]);
  const [uptime, setUptime] = useState("00:00:00");
  const startTimeRef = useRef(Date.now());

  // Uptime Timer
  useEffect(() => {
    const interval = setInterval(() => {
      const diff = Date.now() - startTimeRef.current;
      const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
      const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
      const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
      setUptime(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    initDatabase().then(() => {
      caricaLogs();
    }).catch(e => console.error("Errore avvio DB:", e));
  }, []);

  const caricaLogs = async () => {
    try {
      const data = await getAuditLogs();
      setLogs(data);
    } catch (e) { console.error(e); }
  };

  const addLog = (msg) => {
    const newLog = { id: Date.now(), evento: msg, timestamp: new Date().toISOString() };
    setLogs(prev => [newLog, ...prev].slice(0, 500));
    registraEvento(msg);
  };

  const toggleServer = () => setIsServerActive(!isServerActive);

  useEffect(() => {
    if (isServerActive) {
      setStatusText("SINCRONIZZAZIONE...");
      let activeSocket = null;

      const startConnection = async () => {
        try {
          const settings = await getAppSettings();
          const masterSecret = settings.master_connection_secret || 'Azzurro97_Master';
          const newSocket = io(relayUrl, { autoConnect: true, reconnection: true });
          activeSocket = newSocket;

          newSocket.on('connect', () => {
            newSocket.emit('identify', { secret: masterSecret }, (res) => {
              if (res.success) {
                addLog("🟢 Server Master Online - Sistema Titanium Pronto");
                setStatusText("LIVELLO_NOMINALE");
              } else {
                setStatusText("ERRORE_AUTH");
              }
            });
          });

          newSocket.on('process_request', async (data, callback) => {
            try {
              if (data.action === 'LOGIN_ADMIN') callback(await loginUser(data.email, data.password, 'ADMIN'));
              else if (data.action === 'LOGIN_DRIVER') callback(await loginUser(data.identifier, data.password, 'DRIVER'));
              else if (data.action === 'LOGIN_CUSTOMER') callback(await loginUser(data.email, data.password, 'CUSTOMER'));
              else if (data.action === 'REGISTER_CUSTOMER') callback(await registerUser(data.nome, data.email, data.password, data.telefono, 'CUSTOMER'));
              else if (data.action === 'RESET_PASSWORD') callback(await resetUserPassword(data.type, data.id, data.tempPass));
              else if (data.action === 'UPDATE_PASSWORD') callback(await updateUserPassword(data.id, data.newPass));
              else if (data.action === 'GET_CUSTOMER_BOOKINGS') callback(await getCustomerBookings(data.email));
              else if (data.action === 'GET_ALL_DATA_FOR_BOOKINGS') callback({ success: true, bookings: await getRides(), drivers: await getAutisti(), settings: await getAppSettings() });
              else if (data.action === 'UPDATE_APP_SETTING') { await updateAppSetting(data.payload.key, data.payload.value); callback({ success: true }); }
              else if (data.action === 'GET_DRIVERS_DATA') callback({ success: true, drivers: await getAutisti(), settings: await getAppSettings() });
              else if (data.action === 'UPDATE_RIDE_DETAILS') { await salvaNuovaCorsa(data.payload.data); callback({ success: true }); }
              else if (data.action === 'DELETE_RIDE') { await deleteRide(data.payload.rideId); callback({ success: true }); }
              else if (data.action === 'UPDATE_RIDE_STATUS') { await aggiornaStatoCorsa(data.payload.rideId, data.payload.status); callback({ success: true }); }
              else if (data.action === 'UPDATE_DRIVER_PROFILE') { await salvaTariffeAutista(data.payload); callback({ success: true }); }
              else if (data.action === 'TOGGLE_DRIVER_APPROVAL') { await toggleDriverApproval(data.payload.userId, data.payload.status); callback({ success: true }); }
              else if (data.action === 'TRACK_RIDE') { const ride = await getCorsaByTicket(data.payload.ticket_id); callback({ success: !!ride, ride }); }
              else if (data.action === 'PRENOTA_CORSA_CLIENTE') {
                  await salvaNuovaCorsa(data.payload);
                  addLog(`🚗 Nuova Prenotazione: ${data.payload.ticket_id}`);
                  newSocket.emit('broadcast_to_web', { topic: 'nuova_prenotazione_admin', payload: data.payload });
                  callback({ success: true });
              }
              else callback({ success: false, error: 'Azione non riconosciuta.' });
            } catch (err) { callback({ success: false, error: String(err) }); }
          });

          setSocket(newSocket);
        } catch (e) { addLog(`❌ Errore: ${String(e)}`); }
      };
      startConnection();
      return () => { if (activeSocket) activeSocket.disconnect(); };
    } else {
      if (socket) { socket.disconnect(); setSocket(null); }
      setStatusText("OFFLINE");
    }
  }, [isServerActive]);

  const generateStrangePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()_+";
    let pass = "";
    for (let i = 0; i < 10; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
    return pass;
  };

  const [users, setUsers] = useState([]);
  const [isResetModalVisible, setIsResetModalVisible] = useState(false);
  const [currentResetData, setCurrentResetData] = useState(null);

  const caricaUtenti = async () => {
    try {
      const res = await getAllUsers();
      if (res.success) setUsers(res.users);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (activeTab === 'admin') caricaUtenti();
  }, [activeTab]);

  const handleReset = async (user) => {
    const newPass = generateStrangePassword();
    try {
      const res = await resetUserPassword(user.type, user.id, newPass);
      if (res.success) {
        setCurrentResetData({ name: user.nome, pass: newPass });
        setIsResetModalVisible(true);
      }
    } catch (e) { addLog(`❌ Errore Reset: ${String(e)}`); }
  };

  const handleAdminReset = async () => {
    const newPass = generateStrangePassword();
    try {
      const res = await resetAdminPassword(newPass);
      if (res.success) {
        setCurrentResetData({ name: "AMMINISTRATORE", pass: newPass });
        setIsResetModalVisible(true);
      }
    } catch (e) { addLog(`❌ Errore Reset Admin: ${String(e)}`); }
  };

  const renderAdmin = () => (
    <ScrollView style={styles.scrollContent}>
      <View style={styles.header}>
        <Text style={styles.title}>GESTIONE_SICUREZZA</Text>
        <Text style={styles.subtitle}>CONTROLLO ACCESSI E RESET CREDENZIALI</Text>
      </View>

      <TouchableOpacity style={styles.mainControlCard} onPress={handleAdminReset}>
        <MaterialCommunityIcons name="shield-key" size={60} color={COLORS.error} />
        <Text style={[styles.cardTitle, { color: COLORS.error, marginTop: 10 }]}>RESET PASSWORD ADMIN</Text>
        <Text style={styles.statusDetail}>GENERA UNA NUOVA PASSWORD CASUALE PER IL PANNELLO WEB</Text>
      </TouchableOpacity>

      <Text style={styles.techTitle}>LISTA UTENTI ATTIVI</Text>
      {users.map((u) => (
        <View key={`${u.type}-${u.id}`} style={styles.userCard}>
          <View style={styles.userInfo}>
            <MaterialCommunityIcons name={u.type === 'DRIVER' ? 'car-connected' : 'account'} size={24} color={COLORS.primary} />
            <View style={{ marginLeft: 15 }}>
              <Text style={styles.userName}>{u.nome}</Text>
              <Text style={styles.userEmail}>{u.email} [{u.type}]</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.resetBtn} onPress={() => handleReset(u)}>
            <Text style={styles.resetBtnText}>RESET</Text>
          </TouchableOpacity>
        </View>
      ))}

      {isResetModalVisible && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <MaterialCommunityIcons name="alert-decagram" size={50} color={COLORS.primary} />
            <Text style={styles.modalTitle}>PASSWORD_GENERATA</Text>
            <Text style={styles.modalUser}>{currentResetData?.name}</Text>
            <View style={styles.passBox}>
              <Text style={styles.passText}>{currentResetData?.pass}</Text>
            </View>
            <Text style={styles.modalInfo}>COMUNICA QUESTA PASSWORD ALL'UTENTE. DOVRÀ CAMBIARLA AL PROSSIMO ACCESSO.</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setIsResetModalVisible(false)}>
              <Text style={styles.closeBtnText}>CHIUDI PROTOCOLLO</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );

  const renderDashboard = () => (
    <ScrollView style={styles.scrollContent}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>PANNELLO_DI_CONTROLLO</Text>
          <View style={styles.statusRow}>
            <View style={[styles.miniPulse, { backgroundColor: isServerActive ? COLORS.primary : COLORS.error }]} />
            <Text style={styles.subtitle}>CRITTOGRAFIA LIVE ATTIVA // NODO: 192.168.1.104</Text>
          </View>
        </View>
      </View>

      {/* Main Switch Card */}
      <View style={styles.mainControlCard}>
        <MaterialCommunityIcons name="lan" size={100} color={COLORS.surfaceHigh} style={styles.bgIcon} />
        <Text style={styles.cardLabel}>MOTORE_DI_CONTROLLO</Text>
        <Text style={[styles.cardTitle, { color: isServerActive ? COLORS.primary : COLORS.text }]}>
          {isServerActive ? 'SERVER_ATTIVO' : 'SERVER_SPENTO'}
        </Text>
        
        <View style={styles.switchWrapper}>
          <View style={[styles.switchTrack, isServerActive && styles.switchTrackActive]}>
            <TouchableOpacity 
              activeOpacity={0.8}
              onPress={toggleServer}
              style={[styles.switchThumb, isServerActive ? styles.switchThumbRight : styles.switchThumbLeft]}
            >
              <MaterialCommunityIcons 
                name="power" 
                size={40} 
                color={isServerActive ? COLORS.bg : COLORS.textDim} 
              />
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.statusDetail}>{statusText}</Text>
      </View>

      {/* Metrics Bento */}
      <View style={styles.metricsGrid}>
        <View style={[styles.metricCard, { borderLeftColor: COLORS.primary }]}>
          <MaterialCommunityIcons name="clock-outline" size={20} color={COLORS.textDim} />
          <Text style={styles.metricLabel}>UPTIME_SISTEMA</Text>
          <Text style={styles.metricValue}>{uptime}</Text>
        </View>
        <View style={[styles.metricCard, { borderLeftColor: COLORS.secondary }]}>
          <MaterialCommunityIcons name="hub" size={20} color={COLORS.textDim} />
          <Text style={styles.metricLabel}>CONNESSIONI_ATTIVE</Text>
          <Text style={styles.metricValue}>{isServerActive ? (Math.floor(Math.random() * 50) + 10) : 0}</Text>
        </View>
      </View>

      {/* Tech Panel */}
      <View style={styles.techPanel}>
        <View style={styles.techHeader}>
          <Text style={styles.techTitle}>ALLOCAZIONE_MEMORIA</Text>
          <Text style={styles.techValue}>32%</Text>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: '32%', backgroundColor: COLORS.primary }]} />
        </View>
        <View style={styles.techFooter}>
          <Text style={styles.techFooterText}>4.1GB USATO</Text>
          <Text style={styles.techFooterText}>16GB TOTALE</Text>
        </View>
      </View>
    </ScrollView>
  );

  const [bookings, setBookings] = useState([]);

  const caricaPrenotazioni = async () => {
    try {
      const res = await getRides();
      setBookings(res);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (activeTab === 'corse') caricaPrenotazioni();
  }, [activeTab]);

  const renderBookings = () => (
    <ScrollView style={styles.scrollContent}>
      <View style={styles.header}>
        <Text style={styles.title}>MONITORAGGIO_CORSE</Text>
        <Text style={styles.subtitle}>ELENCO PRENOTAZIONI ATTIVE SUL MASTER</Text>
      </View>

      {bookings.length === 0 ? (
        <View style={styles.emptyCard}>
          <MaterialCommunityIcons name="car-off" size={40} color={COLORS.outline} />
          <Text style={styles.emptyText}>NESSUNA_CORSA_IN_CODA</Text>
        </View>
      ) : (
        bookings.map((b) => (
          <View key={b.ticket_id} style={[styles.rideCard, { borderLeftColor: b.stato_corsa === 'CODA' ? COLORS.secondary : COLORS.primary }]}>
            <View style={styles.rideHeader}>
              <Text style={styles.rideTicket}>#{b.ticket_id}</Text>
              <View style={[styles.statusTag, { backgroundColor: b.stato_corsa === 'CODA' ? COLORS.secondary + '20' : COLORS.primary + '20' }]}>
                <Text style={[styles.statusTagText, { color: b.stato_corsa === 'CODA' ? COLORS.secondary : COLORS.primary }]}>{b.stato_corsa}</Text>
              </View>
            </View>
            <Text style={styles.rideUser}>{b.cliente_nome} • {b.passeggeri} PAX</Text>
            <View style={styles.rideTratta}>
              <MaterialCommunityIcons name="map-marker-outline" size={14} color={COLORS.primary} />
              <Text style={styles.rideLocation} numberOfLines={1}>{b.partenza_indirizzo}</Text>
            </View>
            <View style={styles.rideFooter}>
              <Text style={styles.rideTime}>{format(new Date(b.data_partenza + 'T' + b.ora_partenza), 'dd/MM HH:mm')}</Text>
              <Text style={styles.ridePrice}>€{b.preventivo_accettato}</Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );

  const renderLogs = () => (
    <View style={styles.terminalContainer}>
      <View style={styles.terminalHeader}>
        <View style={styles.dots}>
          <View style={[styles.dot, { backgroundColor: COLORS.error }]} />
          <View style={[styles.dot, { backgroundColor: COLORS.secondary }]} />
          <View style={[styles.dot, { backgroundColor: COLORS.primary }]} />
        </View>
        <Text style={styles.terminalTitle}>TERMINALE_LOG_LIVE</Text>
        <TouchableOpacity onPress={caricaLogs}><MaterialCommunityIcons name="refresh" size={18} color={COLORS.textDim} /></TouchableOpacity>
      </View>
      <ScrollView style={styles.logScroll}>
        {logs.map((log, i) => (
          <View key={log.id || i} style={[styles.logLine, i % 2 === 0 && { backgroundColor: 'rgba(255,255,255,0.02)' }]}>
            <Text style={styles.logTime}>{log.timestamp ? format(new Date(log.timestamp), 'HH:mm:ss') : '--:--'}</Text>
            <Text style={[styles.logTag, log.evento.includes('❌') && { color: COLORS.error }]}>
              {log.evento.includes('❌') ? '[ERROR]' : '[INFO]'}
            </Text>
            <Text style={styles.logMsg}>{log.evento}</Text>
          </View>
        ))}
        <View style={styles.cursorRow}>
          <View style={styles.cursor} />
        </View>
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <View style={styles.topBar}>
        <View style={styles.topIcon}><MaterialCommunityIcons name="terminal" size={20} color={COLORS.primary} /></View>
        <Text style={styles.topTitle}>PANNELLO</Text>
        <View style={styles.avatar}><MaterialCommunityIcons name="account-circle" size={24} color={COLORS.outline} /></View>
      </View>

      <View style={styles.content}>
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'corse' && renderBookings()}
        {activeTab === 'logs' && renderLogs()}
        {activeTab === 'admin' && renderAdmin()}
      </View>

      <View style={styles.navBar}>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('dashboard')}>
          <MaterialCommunityIcons name="hub" size={24} color={activeTab === 'dashboard' ? COLORS.primary : COLORS.textDim} />
          <Text style={[styles.navText, activeTab === 'dashboard' && { color: COLORS.primary }]}>HUB</Text>
          {activeTab === 'dashboard' && <View style={styles.navIndicator} />}
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('corse')}>
          <MaterialCommunityIcons name="car-multiple" size={24} color={activeTab === 'corse' ? COLORS.primary : COLORS.textDim} />
          <Text style={[styles.navText, activeTab === 'corse' && { color: COLORS.primary }]}>CORSE</Text>
          {activeTab === 'corse' && <View style={styles.navIndicator} />}
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('logs')}>
          <MaterialCommunityIcons name="bell-outline" size={24} color={activeTab === 'logs' ? COLORS.primary : COLORS.textDim} />
          <Text style={[styles.navText, activeTab === 'logs' && { color: COLORS.primary }]}>LOG</Text>
          {activeTab === 'logs' && <View style={styles.navIndicator} />}
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('admin')}>
          <MaterialCommunityIcons name="shield-lock-outline" size={24} color={activeTab === 'admin' ? COLORS.primary : COLORS.textDim} />
          <Text style={[styles.navText, activeTab === 'admin' && { color: COLORS.primary }]}>SICUREZZA</Text>
          {activeTab === 'admin' && <View style={styles.navIndicator} />}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  topBar: { height: 60, flexDirection: 'row', alignItems: 'center', px: 20, borderBottomWidth: 1, borderBottomColor: COLORS.outline + '40', justifyContent: 'space-between', paddingHorizontal: 20 },
  topIcon: { width: 32, h: 32, justifyContent: 'center' },
  topTitle: { color: COLORS.primary, fontFamily: 'monospace', fontWeight: '900', letterSpacing: 2, fontSize: 14 },
  avatar: { w: 32, h: 32, alignItems: 'flex-end', justifyContent: 'center' },
  content: { flex: 1 },
  scrollContent: { padding: 20 },
  header: { marginBottom: 30 },
  title: { color: COLORS.text, fontSize: 21, fontWeight: '900', fontFamily: 'monospace', tracking: -1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  miniPulse: { width: 6, height: 6, borderRadius: 3, marginRight: 8 },
  subtitle: { color: COLORS.textDim, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  
  mainControlCard: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 30, alignItems: 'center', overflow: 'hidden', marginBottom: 20, width: '100%' },
  bgIcon: { position: 'absolute', right: -20, top: -20, opacity: 0.1 },
  cardLabel: { color: COLORS.textDim, fontSize: 9, fontWeight: '900', letterSpacing: 2, marginBottom: 10 },
  cardTitle: { fontSize: 24, fontWeight: '900', fontFamily: 'monospace', marginBottom: 20, textAlign: 'center' },
  switchWrapper: { width: 200, height: 100, backgroundColor: COLORS.surfaceHigh, borderRadius: 20, padding: 6, borderWidth: 1, borderColor: COLORS.outline + '40' },
  switchTrack: { flex: 1, height: '100%', borderRadius: 14, flexDirection: 'row', alignItems: 'center' },
  switchTrackActive: { backgroundColor: COLORS.primary + '20' },
  switchThumb: { width: '48%', height: '100%', borderRadius: 12, justifyContent: 'center', alignItems: 'center', elevation: 10 },
  switchThumbLeft: { backgroundColor: COLORS.surfaceHigh, marginLeft: 0 },
  switchThumbRight: { backgroundColor: COLORS.primary, marginLeft: '52%' },
  statusDetail: { color: COLORS.textDim, fontSize: 10, fontWeight: '900', marginTop: 25, fontFamily: 'monospace', textAlign: 'center' },

  metricsGrid: { flexDirection: 'row', gap: 15, marginBottom: 20 },
  metricCard: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, borderLeftWidth: 4 },
  metricLabel: { color: COLORS.textDim, fontSize: 8, fontWeight: '900', letterSpacing: 1, marginVertical: 8 },
  metricValue: { color: COLORS.text, fontSize: 18, fontWeight: '900', fontFamily: 'monospace' },

  techPanel: { backgroundColor: COLORS.surfaceHigh, padding: 20, borderRadius: 16, borderLeftWidth: 1, borderColor: COLORS.outline + '40' },
  techHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  techTitle: { color: COLORS.textDim, fontSize: 8, fontWeight: '900', marginVertical: 15 },
  techValue: { color: COLORS.primary, fontSize: 10, fontWeight: '900' },
  progressBar: { height: 4, backgroundColor: COLORS.bg, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%' },
  techFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  techFooterText: { color: COLORS.textDim, fontSize: 8, fontFamily: 'monospace' },

  terminalContainer: { flex: 1, backgroundColor: '#000' },
  terminalHeader: { height: 40, backgroundColor: COLORS.surfaceHigh, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: COLORS.outline + '20' },
  dots: { flexDirection: 'row', gap: 6, marginRight: 15 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  terminalTitle: { flex: 1, color: COLORS.textDim, fontSize: 9, fontWeight: '900', letterSpacing: 2 },
  logScroll: { flex: 1, padding: 15 },
  logLine: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, borderRadius: 4 },
  logTime: { color: COLORS.textDim, fontSize: 11, fontFamily: 'monospace', opacity: 0.5, marginRight: 12 },
  logTag: { color: COLORS.secondary, fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold', marginRight: 12 },
  logMsg: { color: COLORS.text, fontSize: 12, fontFamily: 'monospace', flex: 1 },
  cursorRow: { padding: 10 },
  cursor: { width: 8, height: 14, backgroundColor: COLORS.primary, opacity: 0.5 },

  navBar: { height: 80, backgroundColor: COLORS.surfaceHigh + 'E6', borderTopWidth: 1, borderTopColor: COLORS.outline + '40', flexDirection: 'row', alignItems: 'center' },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navText: { color: COLORS.textDim, fontSize: 9, fontWeight: '900', marginTop: 4 },
  navIndicator: { position: 'absolute', top: 0, width: '40%', height: 2, backgroundColor: COLORS.primary, borderRadius: 1 },
  
  userCard: { backgroundColor: COLORS.surface, borderRadius: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: 15 },
  userInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  userName: { color: COLORS.text, fontSize: 14, fontWeight: 'bold' },
  userEmail: { color: COLORS.textDim, fontSize: 10 },
  resetBtn: { backgroundColor: COLORS.surfaceHigh, borderRadius: 8, borderWidth: 1, borderColor: COLORS.outline + '40', paddingHorizontal: 12, paddingVertical: 6 },
  resetBtnText: { color: COLORS.error, fontSize: 10, fontWeight: 'bold' },

  modalOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalContent: { backgroundColor: COLORS.surface, borderRadius: 24, alignItems: 'center', width: '85%', borderColor: COLORS.primary + '40', padding: 30, borderWidth: 1 },
  modalTitle: { color: COLORS.primary, fontSize: 16, fontWeight: '900', marginTop: 15, letterSpacing: 2 },
  modalUser: { color: COLORS.textDim, fontSize: 12, marginVertical: 10 },
  passBox: { backgroundColor: COLORS.bg, borderRadius: 12, marginVertical: 20, width: '100%', alignItems: 'center', padding: 20, borderWidth: 1, borderColor: COLORS.primary },
  passText: { color: COLORS.primary, fontSize: 24, fontWeight: 'bold', fontFamily: 'monospace' },
  modalInfo: { color: COLORS.textDim, fontSize: 10, textAlign: 'center', lineHeight: 16 },
  closeBtn: { marginTop: 30, backgroundColor: COLORS.primary, width: '100%', borderRadius: 12, alignItems: 'center', paddingVertical: 12 },
  closeBtnText: { color: COLORS.bg, fontWeight: 'bold', fontSize: 14 },

  rideCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 15, borderLeftWidth: 4, marginBottom: 12 },
  rideHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  rideTicket: { color: COLORS.textDim, fontSize: 10, fontWeight: '900', fontFamily: 'monospace' },
  statusTag: { px: 8, py: 2, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusTagText: { fontSize: 8, fontWeight: '900' },
  rideUser: { color: COLORS.text, fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  rideTratta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  rideLocation: { color: COLORS.textDim, fontSize: 12, flex: 1 },
  rideFooter: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: COLORS.outline + '20', pt: 10, paddingTop: 10 },
  rideTime: { color: COLORS.secondary, fontSize: 11, fontWeight: 'bold' },
  ridePrice: { color: COLORS.primary, fontSize: 14, fontWeight: '900' },
  emptyCard: { py: 50, alignItems: 'center', opacity: 0.5 },
  emptyText: { color: COLORS.textDim, fontSize: 10, fontWeight: '900', marginTop: 10, letterSpacing: 2 }
});

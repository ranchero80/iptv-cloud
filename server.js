const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_FILE = path.join(__dirname, 'cloud_data.json');

const DEFAULT_CONFIG = {
  monetizationEnabled: false, // true = requiere pago/activación manual por dispositivo
  trialHours: 2, // 2 horas de prueba por defecto para nuevos usuarios
  globalPlaylists: [
    {
      id: 'pl_global_1',
      name: 'IPTV Player Pro',
      url: 'http://sfnooesvp.top:8080/get.php?username=heir001&password=Hehe321@espro&type=m3u_plus',
      epgUrl: null
    }
  ],
  devices: {} // deviceId -> { name, status, registeredAt, expiresAt, lastSeen, isLifetime }
};

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
      return DEFAULT_CONFIG;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    return DEFAULT_CONFIG;
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------- ENDPOINT PÚBLICO PARA LAS APPS ----------------------
app.get('/api/client/handshake', (req, res) => {
  const deviceId = req.query.deviceId;
  if (!deviceId) return res.status(400).json({ error: 'Falta deviceId' });

  const data = readData();
  const now = new Date();

  // Si el dispositivo es nuevo, registrarlo con 2 horas de prueba
  if (!data.devices[deviceId]) {
    const trialExpiry = new Date(now.getTime() + (2 * 60 * 60 * 1000)); // 2 horas exactas
    data.devices[deviceId] = {
      name: 'Usuario ' + deviceId.slice(-6),
      status: 'active', // Activo durante las 2 horas de prueba
      registeredAt: now.toISOString(),
      expiresAt: trialExpiry.toISOString(),
      lastSeen: now.toISOString()
    };
    writeData(data);
  } else {
    data.devices[deviceId].lastSeen = now.toISOString();
    writeData(data);
  }

  const device = data.devices[deviceId];
  const isLifetime = device.isLifetime || (device.expiresAt && new Date(device.expiresAt).getFullYear() > 2090);
  const isExpired = !isLifetime && new Date(device.expiresAt) < now;

  let hasAccess = true;
  let statusMessage = isLifetime ? 'Licencia activa (De por vida)' : 'Licencia activa';

  if (data.monetizationEnabled) {
    if (device.status !== 'active') {
      hasAccess = false;
      statusMessage = 'Dispositivo suspendido o pendiente de pago';
    } else if (isExpired) {
      hasAccess = false;
      statusMessage = 'Tu suscripción ha caducado. Contacta al administrador para renovar.';
    }
  }

  res.json({
    active: hasAccess,
    monetizationEnabled: data.monetizationEnabled,
    statusMessage,
    isLifetime,
    expiresAt: isLifetime ? 'De por vida' : device.expiresAt,
    playlists: hasAccess ? data.globalPlaylists : []
  });
});

// ---------------------- PANEL DE ADMINISTRACIÓN WEB ----------------------
app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>IPTV Pro Cloud - Panel de Control</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    .container { max-width: 1000px; margin: 0 auto; }
    h1, h2 { color: #38bdf8; }
    .card { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid #334155; }
    .btn { background: #0284c7; color: white; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-weight: 600; }
    .btn:hover { background: #0369a1; }
    .btn-danger { background: #ef4444; }
    .btn-success { background: #10b981; }
    input, select { background: #0f172a; color: white; border: 1px solid #475569; padding: 10px; border-radius: 6px; width: 100%; box-sizing: border-box; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #334155; font-size: 13.5px; }
    th { color: #94a3b8; }
    .badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .badge-active { background: #10b981; color: black; }
    .badge-expired { background: #ef4444; color: white; }
    .badge-lifetime { background: #8b5cf6; color: white; }
    .switch-container { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
      <h1><i class="fas fa-cloud"></i> Panel Central IPTV Player Pro</h1>
      <span style="color:#94a3b8; font-size:13px;">Servidor Cloud Master</span>
    </div>

    <!-- Control de Monetización -->
    <div class="card">
      <h2><i class="fas fa-dollar-sign"></i> Modelo de Negocio y Monetización</h2>
      <div class="switch-container">
        <div>
          <div style="font-weight:600; font-size:16px;">Exigir Suscripción de Pago para ver Canales y VOD</div>
          <div style="font-size:13px; color:#94a3b8;">Si está desactivado, cualquier usuario con tu app puede ver todo gratis. Al activarlo, solo verán los canales los clientes que tengan la licencia activa en la tabla inferior.</div>
        </div>
        <button class="btn" id="btnToggleMonetization" onclick="toggleMonetization()">Cargando...</button>
      </div>
    </div>

    <!-- Listas Globales -->
    <div class="card">
      <h2><i class="fas fa-list"></i> Listas IPTV Maestras Distribuidas a Todos los Clientes</h2>
      <div style="font-size:13px; color:#94a3b8; margin-bottom:12px;">Cuando agregues o cambies una lista aquí, todos tus usuarios la recibirán automáticamente en sus apps (PC, Móvil, TV).</div>
      <form onsubmit="addPlaylist(event)">
        <input type="text" id="plName" placeholder="Nombre de la lista (ej: Canales VIP Deportes)" required>
        <input type="url" id="plUrl" placeholder="URL M3U o Servidor Xtream" required>
        <input type="url" id="plEpg" placeholder="URL Guía EPG (XMLTV opcional)">
        <button type="submit" class="btn"><i class="fas fa-plus"></i> Añadir Lista Maestra</button>
      </form>
      <div id="playlistsTable"></div>
    </div>

    <!-- Dispositivos y Clientes -->
    <div class="card">
      <h2><i class="fas fa-users"></i> Dispositivos de Usuarios y Control de Licencias</h2>
      <div style="font-size:13px; color:#94a3b8;">Clientes que han abierto tu aplicación. Puedes activar su suscripción por meses o bloquearlos.</div>
      <div id="devicesTable"></div>
    </div>
  </div>

  <script>
    let currentConfig = null;

    async function loadData() {
      const res = await fetch('/api/admin/data');
      currentConfig = await res.json();
      renderUI();
    }

    function renderUI() {
      // Botón Monetización
      const btn = document.getElementById('btnToggleMonetization');
      if (currentConfig.monetizationEnabled) {
        btn.textContent = 'Modo Pago: ACTIVADO';
        btn.className = 'btn btn-success';
      } else {
        btn.textContent = 'Modo Gratuito: TODOS PUEDEN VER';
        btn.className = 'btn';
      }

      // Tabla Listas
      const plDiv = document.getElementById('playlistsTable');
      plDiv.innerHTML = '<table><tr><th>Nombre</th><th>URL</th><th>Acción</th></tr>' +
        currentConfig.globalPlaylists.map(p => '<tr><td><strong>' + p.name + '</strong></td><td style="font-family:monospace; font-size:12px;">' + p.url + '</td><td><button class="btn btn-danger" style="padding:4px 8px; font-size:11px;" onclick="deletePlaylist(\\'' + p.id + '\\')">Eliminar</button></td></tr>').join('') + '</table>';

      // Tabla Dispositivos
      const devDiv = document.getElementById('devicesTable');
      const devKeys = Object.keys(currentConfig.devices);
      if (devKeys.length === 0) {
        devDiv.innerHTML = '<div style="color:#94a3b8; padding:16px 0;">Aún no se ha conectado ningún dispositivo. Abre la app en PC o TV para verlo aquí.</div>';
        return;
      }

      devDiv.innerHTML = '<table><tr><th>ID Dispositivo</th><th>Nombre</th><th>Expira</th><th>Estado</th><th>Acciones de Activación</th></tr>' +
        devKeys.map(k => {
          const d = currentConfig.devices[k];
          const isLifetime = d.isLifetime || (d.expiresAt && new Date(d.expiresAt).getFullYear() > 2090);
          const isExp = !isLifetime && new Date(d.expiresAt) < new Date();
          const badgeClass = isLifetime ? 'badge-lifetime' : ((!isExp && d.status === 'active') ? 'badge-active' : 'badge-expired');
          const badgeText = isLifetime ? 'De por Vida' : ((!isExp && d.status === 'active') ? 'Activo' : 'Caducado / Bloqueado');
          
          const expDate = new Date(d.expiresAt);
          let expDisplay = '';
          if (isLifetime) {
            expDisplay = '<span style="color:#a78bfa; font-weight:700;"><i class="fas fa-infinity"></i> De por Vida</span>';
          } else {
            const diffMin = Math.round((expDate - new Date()) / (1000 * 60));
            if (diffMin > 0 && diffMin <= 180) {
              expDisplay = '<span style="color:#38bdf8; font-weight:700;">' + expDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + diffMin + 'm restantes)</span>';
            } else if (diffMin > 180 && diffMin <= 2880) {
              const diffH = Math.round(diffMin / 60);
              expDisplay = '<span style="color:#38bdf8;">' + expDate.toLocaleDateString() + ' (' + diffH + 'h)</span>';
            } else {
              expDisplay = expDate.toLocaleDateString();
            }
          }

          return '<tr><td style="font-family:monospace; font-weight:700;">' + k + '</td><td>' + d.name + '</td><td>' + expDisplay + '</td><td><span class="badge ' + badgeClass + '">' + badgeText + '</span></td><td style="white-space:nowrap;">' +
            '<button class="btn" style="background:#0284c7; padding:4px 7px; font-size:11px; margin-right:3px;" onclick="renewHours(\\'' + k + '\\', 2)">2h Prueba</button>' +
            '<button class="btn btn-success" style="padding:4px 7px; font-size:11px; margin-right:3px;" onclick="renewDays(\\'' + k + '\\', 30)">1 Mes</button>' +
            '<button class="btn btn-success" style="padding:4px 7px; font-size:11px; margin-right:3px;" onclick="renewDays(\\'' + k + '\\', 90)">3 Meses</button>' +
            '<button class="btn btn-success" style="padding:4px 7px; font-size:11px; margin-right:3px;" onclick="renewDays(\\'' + k + '\\', 180)">6 Meses</button>' +
            '<button class="btn btn-success" style="padding:4px 7px; font-size:11px; margin-right:3px;" onclick="renewDays(\\'' + k + '\\', 365)">1 Año</button>' +
            '<button class="btn" style="background:#8b5cf6; padding:4px 7px; font-size:11px; margin-right:3px;" onclick="renewLifetime(\\'' + k + '\\')"><i class="fas fa-infinity"></i> De por Vida</button>' +
            '<button class="btn btn-danger" style="padding:4px 7px; font-size:11px;" onclick="blockDevice(\\'' + k + '\\')">Bloquear</button>' +
            '</td></tr>';
        }).join('') + '</table>';
    }

    async function toggleMonetization() {
      currentConfig.monetizationEnabled = !currentConfig.monetizationEnabled;
      await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monetizationEnabled: currentConfig.monetizationEnabled })
      });
      loadData();
    }

    async function addPlaylist(e) {
      e.preventDefault();
      const name = document.getElementById('plName').value;
      const url = document.getElementById('plUrl').value;
      const epgUrl = document.getElementById('plEpg').value;
      await fetch('/api/admin/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, epgUrl })
      });
      document.getElementById('plName').value = '';
      document.getElementById('plUrl').value = '';
      document.getElementById('plEpg').value = '';
      loadData();
    }

    async function deletePlaylist(id) {
      if (!confirm('¿Eliminar esta lista maestra para todos los clientes?')) return;
      await fetch('/api/admin/playlists/' + id, { method: 'DELETE' });
      loadData();
    }

    async function renewHours(id, hours) {
      await fetch('/api/admin/devices/' + id + '/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours })
      });
      loadData();
    }

    async function renewDays(id, days) {
      await fetch('/api/admin/devices/' + id + '/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days })
      });
      loadData();
    }

    async function renewLifetime(id) {
      await fetch('/api/admin/devices/' + id + '/lifetime', { method: 'POST' });
      loadData();
    }

    async function blockDevice(id) {
      await fetch('/api/admin/devices/' + id + '/block', { method: 'POST' });
      loadData();
    }

    loadData();
  </script>
</body>
</html>
  `);
});

// APIs para el Panel Admin
app.get('/api/admin/data', (req, res) => {
  res.json(readData());
});

app.post('/api/admin/config', (req, res) => {
  const data = readData();
  if (req.body.monetizationEnabled !== undefined) {
    data.monetizationEnabled = req.body.monetizationEnabled;
  }
  writeData(data);
  res.json({ success: true });
});

app.post('/api/admin/playlists', (req, res) => {
  const data = readData();
  const id = 'pl_cloud_' + Math.random().toString(36).substr(2, 9);
  data.globalPlaylists.push({
    id,
    name: req.body.name,
    url: req.body.url,
    epgUrl: req.body.epgUrl || null
  });
  writeData(data);
  res.json({ success: true });
});

app.delete('/api/admin/playlists/:id', (req, res) => {
  const data = readData();
  data.globalPlaylists = data.globalPlaylists.filter(p => p.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

app.post('/api/admin/devices/:id/renew', (req, res) => {
  const data = readData();
  const hours = req.body.hours;
  const days = req.body.days;
  if (data.devices[req.params.id]) {
    const currentExp = new Date(data.devices[req.params.id].expiresAt);
    const now = new Date();
    const base = currentExp > now ? currentExp : now;
    let msToAdd = 0;
    if (hours) {
      msToAdd = hours * 60 * 60 * 1000;
    } else if (days) {
      msToAdd = days * 24 * 60 * 60 * 1000;
    } else {
      msToAdd = 30 * 24 * 60 * 60 * 1000;
    }
    data.devices[req.params.id].expiresAt = new Date(base.getTime() + msToAdd).toISOString();
    data.devices[req.params.id].isLifetime = false;
    data.devices[req.params.id].status = 'active';
    writeData(data);
  }
  res.json({ success: true });
});

app.post('/api/admin/devices/:id/lifetime', (req, res) => {
  const data = readData();
  if (data.devices[req.params.id]) {
    data.devices[req.params.id].expiresAt = new Date('2099-12-31T23:59:59.000Z').toISOString();
    data.devices[req.params.id].isLifetime = true;
    data.devices[req.params.id].status = 'active';
    writeData(data);
  }
  res.json({ success: true });
});

app.post('/api/admin/devices/:id/block', (req, res) => {
  const data = readData();
  if (data.devices[req.params.id]) {
    data.devices[req.params.id].status = 'blocked';
    writeData(data);
  }
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`☁️ SERVIDOR CLOUD IPTV PRO ACTIVO`);
  console.log(`🌐 Panel Admin: http://localhost:${PORT}/admin`);
  console.log(`===============================================`);
});

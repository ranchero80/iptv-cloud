const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

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
      isLifetime: false,
      lastSeen: now.toISOString()
    };
    writeData(data);
  } else {
    data.devices[deviceId].lastSeen = now.toISOString();
    writeData(data);
  }

  const device = data.devices[deviceId];
  const isBlocked = (device.status === 'blocked');
  const isLifetime = !isBlocked && (device.isLifetime === true);
  const expDate = new Date(device.expiresAt);
  const isExpired = !isBlocked && !isLifetime && (expDate < now);

  let hasAccess = true;
  let statusMessage = 'Licencia activa';

  if (isBlocked) {
    hasAccess = false;
    statusMessage = 'Dispositivo suspendido o bloqueado por el administrador.';
  } else if (isLifetime) {
    hasAccess = true;
    statusMessage = 'Licencia permanente (De por vida).';
  } else if (isExpired) {
    if (data.monetizationEnabled) {
      hasAccess = false;
      statusMessage = 'Tu suscripción o periodo de prueba ha caducado. Contacta al administrador para renovar.';
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
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    .container { max-width: 1100px; margin: 0 auto; }
    h1, h2 { color: #38bdf8; margin-top: 0; }
    .card { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid #334155; }
    .btn { background: #0284c7; color: white; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; }
    .btn:hover { background: #0369a1; }
    .btn-danger { background: #ef4444; }
    .btn-danger:hover { background: #dc2626; }
    .btn-success { background: #10b981; }
    .btn-success:hover { background: #059669; }
    input, select { background: #0f172a; color: white; border: 1px solid #475569; padding: 10px; border-radius: 6px; width: 100%; box-sizing: border-box; margin-bottom: 12px; font-size: 13.5px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { text-align: left; padding: 12px 10px; border-bottom: 1px solid #334155; font-size: 13px; vertical-align: middle; }
    th { color: #94a3b8; font-weight: 600; }
    
    /* Insignias de Estado con estilo sólido y sin saltos de línea */
    .badge {
      display: inline-block;
      white-space: nowrap;
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    .badge-active { background: #10b981; color: #022c22; }
    .badge-trial { background: #0284c7; color: #ffffff; }
    .badge-lifetime { background: #8b5cf6; color: #ffffff; }
    .badge-expired { background: #f97316; color: #ffffff; }
    .badge-blocked { background: #ef4444; color: #ffffff; }
    
    .switch-container { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
    
    /* Grupo de botones de activación */
    .action-btn-group {
      display: flex;
      flex-wrap: nowrap;
      gap: 5px;
      align-items: center;
    }
    .btn-action {
      padding: 5px 10px;
      font-size: 11.5px;
      border-radius: 6px;
      border: none;
      color: #fff;
      cursor: pointer;
      font-weight: 700;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .btn-action:hover {
      opacity: 0.9;
      transform: translateY(-1px);
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    }
    .btn-action:active {
      transform: translateY(0);
    }

    /* Mensaje flotante de confirmación */
    #toast {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #10b981;
      color: #022c22;
      padding: 12px 20px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 14px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.4);
      display: none;
      z-index: 9999;
    }
  </style>
</head>
<body>
  <div id="toast"></div>

  <div class="container">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
      <h1><i class="fas fa-cloud"></i> Panel Central IPTV Player Pro</h1>
      <button class="btn" style="background:#334155;" onclick="loadData()"><i class="fas fa-rotate"></i> Actualizar</button>
    </div>

    <!-- Control de Monetización -->
    <div class="card">
      <h2><i class="fas fa-dollar-sign"></i> Modelo de Negocio y Monetización</h2>
      <div class="switch-container">
        <div style="max-width: 75%;">
          <div style="font-weight:600; font-size:16px;">Exigir Suscripción de Pago para ver Canales y VOD</div>
          <div style="font-size:13px; color:#94a3b8; margin-top:4px;">Si está desactivado, cualquier usuario con tu app puede ver todo gratis. Al activarlo, solo verán los canales los clientes que tengan la licencia activa en la tabla inferior.</div>
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
      <div style="font-size:13px; color:#94a3b8; margin-bottom:12px;">Clientes que han abierto tu aplicación. Pulsa cualquier botón para cambiar su estado al instante.</div>
      <div id="devicesTable"></div>
    </div>
  </div>

  <script>
    let currentConfig = null;

    function showToast(msg, isError = false) {
      const toast = document.getElementById('toast');
      toast.style.background = isError ? '#ef4444' : '#10b981';
      toast.style.color = isError ? '#ffffff' : '#022c22';
      toast.innerHTML = (isError ? '<i class="fas fa-circle-exclamation"></i> ' : '<i class="fas fa-circle-check"></i> ') + msg;
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 2600);
    }

    async function loadData() {
      try {
        const res = await fetch('/api/admin/data');
        currentConfig = await res.json();
        renderUI();
      } catch (err) {
        showToast('Error cargando datos del servidor', true);
      }
    }

    function renderUI() {
      if (!currentConfig) return;

      // Botón Monetización
      const btn = document.getElementById('btnToggleMonetization');
      if (currentConfig.monetizationEnabled) {
        btn.innerHTML = '<i class="fas fa-lock"></i> Modo Pago: ACTIVADO';
        btn.className = 'btn btn-success';
      } else {
        btn.innerHTML = '<i class="fas fa-lock-open"></i> Modo Gratuito: TODOS PUEDEN VER';
        btn.className = 'btn';
      }

      // Tabla Listas
      const plDiv = document.getElementById('playlistsTable');
      plDiv.innerHTML = '<table><tr><th>Nombre</th><th>URL</th><th>Acción</th></tr>' +
        currentConfig.globalPlaylists.map(p => '<tr><td><strong>' + p.name + '</strong></td><td style="font-family:monospace; font-size:12px; color:#cbd5e1;">' + p.url + '</td><td><button class="btn btn-danger" style="padding:5px 10px; font-size:11px;" onclick="deletePlaylist(\\'' + p.id + '\\')"><i class="fas fa-trash"></i> Eliminar</button></td></tr>').join('') + '</table>';

      // Tabla Dispositivos
      const devDiv = document.getElementById('devicesTable');
      const devKeys = Object.keys(currentConfig.devices || {});
      if (devKeys.length === 0) {
        devDiv.innerHTML = '<div style="color:#94a3b8; padding:20px 0; text-align:center;"><i class="fas fa-mobile-screen" style="font-size:24px; margin-bottom:8px; display:block;"></i>Aún no se ha conectado ningún dispositivo. Abre la app en PC o TV para verlo aquí.</div>';
        return;
      }

      const now = new Date();

      devDiv.innerHTML = '<table><tr><th>ID Dispositivo</th><th>Nombre</th><th>Expira</th><th>Estado</th><th>Acciones de Activación</th></tr>' +
        devKeys.map(k => {
          const d = currentConfig.devices[k];
          const isBlocked = (d.status === 'blocked');
          const isLifetime = !isBlocked && (d.isLifetime === true);
          const expDate = new Date(d.expiresAt);
          const isExp = !isBlocked && !isLifetime && (expDate < now);

          let badgeClass = 'badge-active';
          let badgeText = 'ACTIVO';
          let expDisplay = '';

          if (isBlocked) {
            badgeClass = 'badge-blocked';
            badgeText = 'BLOQUEADO';
            expDisplay = '<span style="color:#ef4444; font-weight:700;"><i class="fas fa-ban"></i> Acceso Bloqueado</span>';
          } else if (isLifetime) {
            badgeClass = 'badge-lifetime';
            badgeText = 'DE POR VIDA';
            expDisplay = '<span style="color:#a78bfa; font-weight:700;"><i class="fas fa-infinity"></i> De por Vida</span>';
          } else if (isExp) {
            badgeClass = 'badge-expired';
            badgeText = 'CADUCADO';
            expDisplay = '<span style="color:#f97316; font-weight:600;"><i class="fas fa-clock"></i> Caducado</span>';
          } else {
            // Activo o Prueba
            const diffMin = Math.round((expDate - now) / (1000 * 60));
            if (diffMin <= 180) {
              badgeClass = 'badge-trial';
              badgeText = 'PRUEBA (2H)';
              expDisplay = '<span style="color:#38bdf8; font-weight:700;"><i class="fas fa-stopwatch"></i> ' + expDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + diffMin + 'm restantes)</span>';
            } else if (diffMin <= 2880) {
              const diffH = Math.round(diffMin / 60);
              badgeClass = 'badge-active';
              badgeText = 'ACTIVO';
              expDisplay = '<span style="color:#10b981; font-weight:600;">' + expDate.toLocaleDateString() + ' (' + diffH + 'h)</span>';
            } else {
              const diffDays = Math.round(diffMin / (60 * 24));
              badgeClass = 'badge-active';
              badgeText = 'ACTIVO';
              expDisplay = '<span style="color:#10b981; font-weight:600;">' + expDate.toLocaleDateString() + ' (' + diffDays + ' días)</span>';
            }
          }

          return '<tr>' +
            '<td style="font-family:monospace; font-weight:700; color:#38bdf8;">' + k + '</td>' +
            '<td><strong>' + (d.name || 'Dispositivo') + '</strong></td>' +
            '<td>' + expDisplay + '</td>' +
            '<td><span class="badge ' + badgeClass + '">' + badgeText + '</span></td>' +
            '<td style="white-space:nowrap;">' +
              '<div class="action-btn-group">' +
                '<button class="btn-action" style="background:#0284c7;" onclick="setPlan(\\'' + k + '\\', \\'2h\\')" title="Asignar 2 horas de prueba">2h Prueba</button>' +
                '<button class="btn-action" style="background:#10b981;" onclick="setPlan(\\'' + k + '\\', \\'1m\\')" title="Asignar 1 mes de acceso">1 Mes</button>' +
                '<button class="btn-action" style="background:#10b981;" onclick="setPlan(\\'' + k + '\\', \\'3m\\')" title="Asignar 3 meses de acceso">3 Meses</button>' +
                '<button class="btn-action" style="background:#10b981;" onclick="setPlan(\\'' + k + '\\', \\'6m\\')" title="Asignar 6 meses de acceso">6 Meses</button>' +
                '<button class="btn-action" style="background:#10b981;" onclick="setPlan(\\'' + k + '\\', \\'1y\\')" title="Asignar 1 año de acceso">1 Año</button>' +
                '<button class="btn-action" style="background:#8b5cf6;" onclick="setPlan(\\'' + k + '\\', \\'lifetime\\')" title="Asignar suscripción vitalicia"><i class="fas fa-infinity"></i> De por Vida</button>' +
                '<button class="btn-action" style="background:#ef4444;" onclick="setPlan(\\'' + k + '\\', \\'block\\')" title="Bloquear acceso inmediatamente"><i class="fas fa-ban"></i> Bloquear</button>' +
                '<button class="btn-action" style="background:#475569;" onclick="deleteDevice(\\'' + k + '\\')" title="Eliminar este dispositivo"><i class="fas fa-trash"></i></button>' +
              '</div>' +
            '</td>' +
          '</tr>';
        }).join('') + '</table>';
    }

    async function toggleMonetization() {
      currentConfig.monetizationEnabled = !currentConfig.monetizationEnabled;
      await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monetizationEnabled: currentConfig.monetizationEnabled })
      });
      showToast(currentConfig.monetizationEnabled ? 'Modo Pago activado' : 'Modo Gratuito activado');
      await loadData();
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
      showToast('Lista maestra añadida');
      await loadData();
    }

    async function deletePlaylist(id) {
      if (!confirm('¿Eliminar esta lista maestra para todos los clientes?')) return;
      await fetch('/api/admin/playlists/' + id, { method: 'DELETE' });
      showToast('Lista eliminada');
      await loadData();
    }

    async function setPlan(id, planType) {
      try {
        let endpoint = '/api/admin/devices/' + id + '/renew';
        let body = {};
        let label = '';

        if (planType === '2h') {
          body = { hours: 2 };
          label = '2 Horas de Prueba';
        } else if (planType === '1m') {
          body = { days: 30 };
          label = '1 Mes de Suscripción';
        } else if (planType === '3m') {
          body = { days: 90 };
          label = '3 Meses de Suscripción';
        } else if (planType === '6m') {
          body = { days: 180 };
          label = '6 Meses de Suscripción';
        } else if (planType === '1y') {
          body = { days: 365 };
          label = '1 Año de Suscripción';
        } else if (planType === 'lifetime') {
          endpoint = '/api/admin/devices/' + id + '/lifetime';
          label = 'De por Vida (Permanente)';
        } else if (planType === 'block') {
          endpoint = '/api/admin/devices/' + id + '/block';
          label = 'Bloqueado';
        }

        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        showToast('Estado actualizado: ' + label);
        await loadData();
      } catch (e) {
        showToast('Error al actualizar dispositivo', true);
      }
    }

    async function deleteDevice(id) {
      if (!confirm('¿Eliminar este dispositivo? Si vuelve a abrir la app, se registrará como nuevo con sus 2h de prueba gratis.')) return;
      await fetch('/api/admin/devices/' + id, { method: 'DELETE' });
      showToast('Dispositivo eliminado');
      await loadData();
    }

    loadData();
    // Auto-refrescar cada 15 segundos
    setInterval(loadData, 15000);
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

// Asignar duración específica (horas o días desde AHORA)
app.post('/api/admin/devices/:id/renew', (req, res) => {
  const data = readData();
  const device = data.devices[req.params.id];
  if (device) {
    const now = new Date();
    const hours = req.body.hours;
    const days = req.body.days;
    let msToAdd = 0;
    if (hours) {
      msToAdd = hours * 60 * 60 * 1000;
    } else if (days) {
      msToAdd = days * 24 * 60 * 60 * 1000;
    } else {
      msToAdd = 30 * 24 * 60 * 60 * 1000;
    }

    // SIEMPRE calculamos desde NOW para que cambiar entre planes sea inmediato
    device.expiresAt = new Date(now.getTime() + msToAdd).toISOString();
    device.isLifetime = false;
    device.status = 'active';
    writeData(data);
  }
  res.json({ success: true, device: data.devices[req.params.id] });
});

// Asignar De por Vida
app.post('/api/admin/devices/:id/lifetime', (req, res) => {
  const data = readData();
  const device = data.devices[req.params.id];
  if (device) {
    device.expiresAt = new Date('2099-12-31T23:59:59.000Z').toISOString();
    device.isLifetime = true;
    device.status = 'active';
    writeData(data);
  }
  res.json({ success: true, device: data.devices[req.params.id] });
});

// Bloquear dispositivo
app.post('/api/admin/devices/:id/block', (req, res) => {
  const data = readData();
  const device = data.devices[req.params.id];
  if (device) {
    device.status = 'blocked';
    device.isLifetime = false;
    writeData(data);
  }
  res.json({ success: true, device: data.devices[req.params.id] });
});

// Eliminar dispositivo
app.delete('/api/admin/devices/:id', (req, res) => {
  const data = readData();
  delete data.devices[req.params.id];
  writeData(data);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`☁️ SERVIDOR CLOUD IPTV PRO ACTIVO`);
  console.log(`🌐 Panel Admin: http://localhost:${PORT}/admin`);
  console.log(`===============================================`);
});

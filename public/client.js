(function(){
  let socket = null;
  let currentRoomId = null;

  let markers = new Map();
  let lines = new Map();

  let activeMode = null;
  let lineFirstPoint = null;
  let lineType = 'attack';

  let canvas = document.getElementById('mapCanvas');
  let ctx = canvas.getContext('2d');
  let mapImage = new Image();
  let imageLoaded = false;

  const landingDiv = document.getElementById('landing');
  const appDiv = document.getElementById('app');
  const roomIdSpan = document.getElementById('roomIdDisplay');
  const copyLinkBtn = document.getElementById('copyLinkBtn');
  const addAllyBtn = document.getElementById('addAllyBtn');
  const addEnemyBtn = document.getElementById('addEnemyBtn');
  const drawLineBtn = document.getElementById('drawLineBtn');
  const deleteModeBtn = document.getElementById('deleteModeBtn');
  const lineTypeSelect = document.getElementById('lineTypeSelect');

  function clearActiveMode() {
    activeMode = null;
    lineFirstPoint = null;
    [addAllyBtn, addEnemyBtn, drawLineBtn, deleteModeBtn].forEach(btn => btn.classList.remove('active'));
  }

  function setMode(mode) {
    clearActiveMode();
    activeMode = mode;
    if(mode === 'ally') addAllyBtn.classList.add('active');
    if(mode === 'enemy') addEnemyBtn.classList.add('active');
    if(mode === 'line') drawLineBtn.classList.add('active');
    if(mode === 'delete') deleteModeBtn.classList.add('active');
  }

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let mouseX = (e.clientX - rect.left) * scaleX;
    let mouseY = (e.clientY - rect.top) * scaleY;
    mouseX = Math.min(Math.max(0, mouseX), canvas.width);
    mouseY = Math.min(Math.max(0, mouseY), canvas.height);
    return { x: mouseX, y: mouseY };
  }

  function findMarkerAt(x, y) {
    for(let [id, m] of markers.entries()) {
      const dx = m.x - x, dy = m.y - y;
      if(Math.hypot(dx, dy) <= 15) return { id, marker: m };
    }
    return null;
  }

  function findLineAt(px, py) {
    for(let [id, line] of lines.entries()) {
      const { x1, y1, x2, y2 } = line;
      const A = px - x1, B = py - y1;
      const C = x2 - x1, D = y2 - y1;
      const dot = A * C + B * D;
      const len2 = C * C + D * D;
      let t = -1;
      if(len2 > 1e-5) t = dot / len2;
      let closestX, closestY;
      if(t < 0) { closestX = x1; closestY = y1; }
      else if(t > 1) { closestX = x2; closestY = y2; }
      else { closestX = x1 + t * C; closestY = y1 + t * D; }
      const dist = Math.hypot(px - closestX, py - closestY);
      if(dist <= 8) return { id, line };
    }
    return null;
  }

  function drawArrow(fromX, fromY, toX, toY, color, lineWidth = 5) {
    if(!ctx) return;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    const angle = Math.atan2(toY - fromY, toX - fromX);
    const arrowSize = 16;
    const arrowX = toX;
    const arrowY = toY;
    const a1 = angle - Math.PI / 6;
    const a2 = angle + Math.PI / 6;
    const wingX1 = arrowX - arrowSize * Math.cos(a1);
    const wingY1 = arrowY - arrowSize * Math.sin(a1);
    const wingX2 = arrowX - arrowSize * Math.cos(a2);
    const wingY2 = arrowY - arrowSize * Math.sin(a2);
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(wingX1, wingY1);
    ctx.lineTo(wingX2, wingY2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawMarker(x, y, type) {
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, 2*Math.PI);
    ctx.fillStyle = type === 'ally' ? '#6fbf4c' : '#d64531';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px "Segoe UI"';
    ctx.fillText(type === 'ally' ? 'A' : 'E', x-4, y+5);
  }

  function drawLineItem(line) {
    const { x1, y1, x2, y2, lineType } = line;
    let color;
    switch(lineType) {
      case 'attack': color = '#e63946'; break;
      case 'retreat': color = '#1e88e5'; break;
      case 'defense': color = '#2ecc71'; break;
      case 'merge': color = '#f39c12'; break;
      default: color = '#aaa';
    }
    drawArrow(x1, y1, x2, y2, color, 5);
  }

  function drawAll() {
    if(!imageLoaded || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(mapImage, 0, 0, canvas.width, canvas.height);
    for(let line of lines.values()) drawLineItem(line);
    for(let marker of markers.values()) drawMarker(marker.x, marker.y, marker.type);
  }

  function onCanvasClick(e) {
    if(!activeMode) return;
    const { x, y } = getCanvasCoords(e);

    if(activeMode === 'delete') {
      const markerHit = findMarkerAt(x, y);
      if(markerHit) {
        socket.emit('remove-marker', { roomId: currentRoomId, markerId: markerHit.id });
        return;
      }
      const lineHit = findLineAt(x, y);
      if(lineHit) {
        socket.emit('remove-line', { roomId: currentRoomId, lineId: lineHit.id });
        return;
      }
      return;
    }

    if(activeMode === 'ally' || activeMode === 'enemy') {
      const markerType = activeMode === 'ally' ? 'ally' : 'enemy';
      socket.emit('add-marker', { roomId: currentRoomId, marker: { x, y, type: markerType } });
      return;
    }

    if(activeMode === 'line') {
      if(lineFirstPoint === null) {
        lineFirstPoint = { x, y };
      } else {
        const lineData = {
          x1: lineFirstPoint.x,
          y1: lineFirstPoint.y,
          x2: x,
          y2: y,
          lineType: lineType
        };
        socket.emit('add-line', { roomId: currentRoomId, line: lineData });
        lineFirstPoint = null;
        clearActiveMode();
      }
      return;
    }
  }

  function setupSocketListeners() {
    socket.on('room-state', ({ markers: serverMarkers, lines: serverLines }) => {
      markers.clear();
      lines.clear();
      serverMarkers.forEach(m => markers.set(m.id, { x: m.x, y: m.y, type: m.type }));
      serverLines.forEach(l => lines.set(l.id, { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, lineType: l.lineType }));
      drawAll();
    });

    socket.on('marker-added', (marker) => {
      markers.set(marker.id, { x: marker.x, y: marker.y, type: marker.type });
      drawAll();
    });
    socket.on('marker-removed', ({ markerId }) => {
      markers.delete(markerId);
      drawAll();
    });
    socket.on('line-added', (line) => {
      lines.set(line.id, { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2, lineType: line.lineType });
      drawAll();
    });
    socket.on('line-removed', ({ lineId }) => {
      lines.delete(lineId);
      drawAll();
    });
  }

  function initRoom(roomId) {
    currentRoomId = roomId;
    roomIdSpan.textContent = roomId;
    landingDiv.style.display = 'none';
    appDiv.style.display = 'flex';

    socket = io();
    setupSocketListeners();
    socket.emit('join-room', { roomId });

    mapImage.onload = () => {
      canvas.width = mapImage.width;
      canvas.height = mapImage.height;
      imageLoaded = true;
      drawAll();
    };
    mapImage.src = '/DrC_New_Map.png';
  }

  function copyRoomLink() {
    const url = `${window.location.origin}/room/${currentRoomId}`;
    navigator.clipboard.writeText(url);
  }

  function createRoomAndRedirect() {
    window.location.href = '/create-room';
  }

  function joinRoomById() {
    const roomId = document.getElementById('roomIdInput').value.trim();
    if(roomId) window.location.href = `/room/${roomId}`;
  }

  function bindUI() {
    document.getElementById('createRoomBtn').addEventListener('click', createRoomAndRedirect);
    document.getElementById('joinRoomBtn').addEventListener('click', joinRoomById);
    copyLinkBtn.addEventListener('click', copyRoomLink);
    addAllyBtn.addEventListener('click', () => setMode('ally'));
    addEnemyBtn.addEventListener('click', () => setMode('enemy'));
    drawLineBtn.addEventListener('click', () => setMode('line'));
    deleteModeBtn.addEventListener('click', () => setMode('delete'));
    lineTypeSelect.addEventListener('change', (e) => { lineType = e.target.value; });
    canvas.addEventListener('click', onCanvasClick);
  }

  function start() {
    bindUI();
    const match = window.location.pathname.match(/\/room\/([a-zA-Z0-9_-]+)/);
    if(match) {
      initRoom(match[1]);
    } else {
      landingDiv.style.display = 'block';
      appDiv.style.display = 'none';
    }
  }

  start();
})();
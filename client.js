(function(){
  let socket = null;
  let currentRoomId = null;

  let markers = new Map();
  let lines = new Map();

  let activeMode = null;
  let lineFirstPoint = null;
  let previewLine = null;
  let lineType = 'attack';

  let brushDrawing = false;
  let brushPoints = [];
  let brushColor = '#ffaa44';
  // ФИКСИРОВАННЫЕ параметры кисти
  const BRUSH_OPACITY = 0.35;
  const BRUSH_THICKNESS = 50;

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
  const brushBtn = document.getElementById('brushBtn');
  const brushColorPicker = document.getElementById('brushColor');
  const lineTypeSelect = document.getElementById('lineTypeSelect');

  function hexToRgba(hex, alpha) {
    let r = parseInt(hex.slice(1,3), 16);
    let g = parseInt(hex.slice(3,5), 16);
    let b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function clearActiveMode() {
    activeMode = null;
    lineFirstPoint = null;
    previewLine = null;
    brushDrawing = false;
    brushPoints = [];
    [addAllyBtn, addEnemyBtn, drawLineBtn, deleteModeBtn, brushBtn].forEach(btn => btn && btn.classList.remove('active'));
  }

  function setMode(mode) {
    clearActiveMode();
    activeMode = mode;
    if(mode === 'ally') addAllyBtn.classList.add('active');
    if(mode === 'enemy') addEnemyBtn.classList.add('active');
    if(mode === 'line') drawLineBtn.classList.add('active');
    if(mode === 'delete') deleteModeBtn.classList.add('active');
    if(mode === 'brush') brushBtn.classList.add('active');
  }

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX, clientY;
    if(e.touches) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    let x = (clientX - rect.left) * scaleX;
    let y = (clientY - rect.top) * scaleY;
    x = Math.min(Math.max(0, x), canvas.width);
    y = Math.min(Math.max(0, y), canvas.height);
    return { x, y };
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
      if(line.lineType === 'brush' && line.points) {
        for(let i = 0; i < line.points.length - 1; i++) {
          const x1 = line.points[i].x, y1 = line.points[i].y;
          const x2 = line.points[i+1].x, y2 = line.points[i+1].y;
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
          if(dist <= 12) return { id, line };
        }
      } else if (line.x1 !== undefined) {
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
        if(dist <= 10) return { id, line };
      }
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
    const arrowSize = Math.min(16, Math.hypot(toX-fromX, toY-fromY)/2);
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
    if(line.lineType === 'brush' && line.points && line.points.length > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(line.points[0].x, line.points[0].y);
      for(let i = 1; i < line.points.length; i++) {
        ctx.lineTo(line.points[i].x, line.points[i].y);
      }
      const opacity = line.opacity !== undefined ? line.opacity : 0.3;
      const rgbaColor = hexToRgba(line.color || '#ffaa44', opacity);
      ctx.strokeStyle = rgbaColor;
      ctx.lineWidth = line.thickness || 50;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
      return;
    }
    const { x1, y1, x2, y2, lineType } = line;
    if(!x1 || !x2) return;
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

    if(previewLine && activeMode === 'line') {
      let clr;
      switch(lineType) {
        case 'attack': clr = '#e63946'; break;
        case 'retreat': clr = '#1e88e5'; break;
        case 'defense': clr = '#2ecc71'; break;
        case 'merge': clr = '#f39c12'; break;
        default: clr = '#aaa';
      }
      drawArrow(previewLine.x1, previewLine.y1, previewLine.x2, previewLine.y2, clr, 5);
      ctx.beginPath();
      ctx.arc(previewLine.x1, previewLine.y1, 6, 0, 2*Math.PI);
      ctx.fillStyle = clr;
      ctx.fill();
    }

    for(let marker of markers.values()) drawMarker(marker.x, marker.y, marker.type);
  }

  function drawBrushLocally(points, color, opacity, thickness) {
    if(!ctx || points.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for(let i=1; i<points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = hexToRgba(color, opacity);
    ctx.lineWidth = thickness;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function finalizeBrushStroke() {
    if(brushPoints.length < 2) {
      brushPoints = [];
      brushDrawing = false;
      return;
    }
    socket.emit('add-brush-stroke', {
      roomId: currentRoomId,
      points: brushPoints,
      color: brushColor,
      opacity: BRUSH_OPACITY,
      thickness: BRUSH_THICKNESS
    });
    brushPoints = [];
    brushDrawing = false;
  }

  function onCanvasMouseDown(e) {
    if (!activeMode) return;
    if (activeMode === 'brush') e.preventDefault();
    const { x, y } = getCanvasCoords(e);
    if (activeMode === 'brush') {
        brushDrawing = true;
        brushPoints = [{ x, y }];
    }
  }

  function onCanvasMouseMove(e) {
    if (!activeMode) return;
    if (activeMode === 'brush') e.preventDefault();
    const { x, y } = getCanvasCoords(e);

    if(activeMode === 'line' && lineFirstPoint !== null) {
      previewLine = { x1: lineFirstPoint.x, y1: lineFirstPoint.y, x2: x, y2: y };
      drawAll();
      return;
    }

    if(activeMode === 'brush' && brushDrawing) {
      const lastPoint = brushPoints[brushPoints.length-1];
      const dist = Math.hypot(x - lastPoint.x, y - lastPoint.y);
      if(dist > 3) {
        const newPoint = { x, y };
        brushPoints.push(newPoint);
        drawBrushLocally([lastPoint, newPoint], brushColor, BRUSH_OPACITY, BRUSH_THICKNESS);
      }
    }
  }

  function onCanvasMouseUp(e) {
    if (activeMode === 'brush') {
        e.preventDefault();
        if (brushDrawing) {
        finalizeBrushStroke();
        drawAll();
        }
    }
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
        previewLine = { x1: x, y1: y, x2: x, y2: y };
        drawAll();
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
        previewLine = null;
        clearActiveMode();
        drawAll();
      }
    }
  }

  function setupSocketListeners() {
    socket.on('room-state', ({ markers: serverMarkers, lines: serverLines }) => {
      markers.clear();
      lines.clear();
      serverMarkers.forEach(m => markers.set(m.id, { x: m.x, y: m.y, type: m.type }));
      serverLines.forEach(l => lines.set(l.id, { ...l }));
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
      lines.set(line.id, line);
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
    const getElem = (id) => document.getElementById(id);
    const createBtn = getElem('createRoomBtn');
    const joinBtn = getElem('joinRoomBtn');
    if (createBtn) createBtn.addEventListener('click', createRoomAndRedirect);
    if (joinBtn) joinBtn.addEventListener('click', joinRoomById);

    const copyBtn = getElem('copyLinkBtn');
    if (copyBtn) copyBtn.addEventListener('click', copyRoomLink);

    const allyBtn = getElem('addAllyBtn');
    const enemyBtn = getElem('addEnemyBtn');
    const lineBtn = getElem('drawLineBtn');
    const deleteBtn = getElem('deleteModeBtn');
    const brushModeBtn = getElem('brushBtn');

    if (allyBtn) allyBtn.addEventListener('click', () => setMode('ally'));
    if (enemyBtn) enemyBtn.addEventListener('click', () => setMode('enemy'));
    if (lineBtn) lineBtn.addEventListener('click', () => setMode('line'));
    if (deleteBtn) deleteBtn.addEventListener('click', () => setMode('delete'));
    if (brushModeBtn) brushModeBtn.addEventListener('click', () => setMode('brush'));

    const colorPicker = getElem('brushColor');
    const lineSelect = getElem('lineTypeSelect');

    if (colorPicker) colorPicker.addEventListener('change', (e) => { brushColor = e.target.value; });
    if (lineSelect) lineSelect.addEventListener('change', (e) => { lineType = e.target.value; });

    if (canvas) {
        // Мышь
        canvas.addEventListener('mousedown', onCanvasMouseDown);
        canvas.addEventListener('mousemove', onCanvasMouseMove);
        canvas.addEventListener('mouseup', onCanvasMouseUp);
        canvas.addEventListener('click', onCanvasClick);
        
        // Тач (мобильные) – просто вызываем те же функции, без лишних обёрток
        canvas.addEventListener('touchstart', onCanvasMouseDown);
        canvas.addEventListener('touchmove', onCanvasMouseMove);
        canvas.addEventListener('touchend', onCanvasMouseUp);
        // click для мобильных тоже будет работать, так как мы больше не блокируем его везде
    }
  }

  function start() {
    bindUI();
    let path = window.location.pathname;
    if (path.endsWith('/')) path = path.slice(0, -1);
    const parts = path.split('/');
    const roomIndex = parts.indexOf('room');
    let roomId = null;
    if (roomIndex !== -1 && parts.length > roomIndex + 1) {
      roomId = parts[roomIndex + 1];
    }
    if (roomId && roomId.length > 0) {
      initRoom(roomId);
    } else {
      landingDiv.style.display = 'block';
      appDiv.style.display = 'none';
    }
  }

  start();
})();
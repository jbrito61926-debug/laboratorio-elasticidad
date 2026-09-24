const MATERIALES = {
  acero:    { Y: 200e9, limite: 250, color: '#708090' },
  aluminio: { Y: 69e9,  limite: 95,  color: '#C0C0C0' },
  cobre:    { Y: 110e9, limite: 70,  color: '#B87333' },
  goma:     { Y: 0.05e9,limite: 10,  color: '#333333' }
};

let p1, p2;

// --- Estado físico (resultado del cálculo, no animado) ---
let estiramientoObjetivoPx = 0;
let objetivoAnteriorPx = null;
let esfuerzoActualMPa = 0;
let limiteActualMPa = 0;
let estaRoto = false;

// --- Estado de animación (resorte masa-amortiguador visual) ---
let estiramientoAnimadoPx = 0;
let velAnimVertical = 0;
let swayXAnimado = 0;
let velAnimHorizontal = 0;

// --- Estado de la animación de ruptura ---
let rupturaData = null;

let historialPruebas = [];
let miGrafica;

function setup() {
  let canvas = createCanvas(500, 400);
  canvas.parent('canvas-container');

  p1 = createVector(50, 80);
  p2 = createVector(450, 80);

  inicializarGrafica();

  document.getElementById('material').addEventListener('change', actualizarFisica);

  // --- Sincronización slider <-> campo numérico (edición directa) ---
  vincularSliderConNumero('masa', 'masa-num', 1, 500);
  vincularSliderConNumero('diametro', 'diametro-num', 1, 20);

  document.getElementById('btn-exportar').addEventListener('click', descargarCSV);
  document.getElementById('btn-modo-oscuro').addEventListener('click', alternarModoOscuro);

  actualizarFisica();
}

function vincularSliderConNumero(sliderId, numeroId, min, max) {
  const slider = document.getElementById(sliderId);
  const numero = document.getElementById(numeroId);

  slider.addEventListener('input', () => {
    numero.value = slider.value;
    actualizarFisica();
  });

  numero.addEventListener('input', () => {
    // Permite escribir libremente mientras se edita, sin forzar el valor a cada tecla
    if (numero.value === '') return;
    let val = parseFloat(numero.value);
    if (isNaN(val)) return;
    val = Math.min(max, Math.max(min, val));
    slider.value = val;
    actualizarFisica();
  });

  numero.addEventListener('change', () => {
    // Al salir del campo, corrige el valor si quedó vacío o fuera de rango
    let val = parseFloat(numero.value);
    if (isNaN(val)) val = parseFloat(slider.value);
    val = Math.min(max, Math.max(min, val));
    numero.value = val;
    slider.value = val;
    actualizarFisica();
  });
}

function alternarModoOscuro() {
  const activo = document.body.classList.toggle('dark-mode');
  const btn = document.getElementById('btn-modo-oscuro');
  btn.setAttribute('aria-pressed', activo ? 'true' : 'false');
  btn.textContent = activo ? '☀️ Modo Claro' : '🌙 Modo Oscuro';
  actualizarColoresGrafica();
}

function actualizarColoresGrafica() {
  if (!miGrafica) return;
  const oscuro = document.body.classList.contains('dark-mode');
  const colorTexto = oscuro ? '#e6e6e6' : '#333333';
  const colorGrid = oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

  miGrafica.options.scales.x.title.color = colorTexto;
  miGrafica.options.scales.y.title.color = colorTexto;
  miGrafica.options.scales.x.ticks = { color: colorTexto };
  miGrafica.options.scales.y.ticks = { color: colorTexto };
  miGrafica.options.scales.x.grid = { color: colorGrid };
  miGrafica.options.scales.y.grid = { color: colorGrid };
  miGrafica.options.plugins = miGrafica.options.plugins || {};
  miGrafica.options.plugins.legend = { labels: { color: colorTexto } };
  miGrafica.update();
}

function inicializarGrafica() {
  const ctx = document.getElementById('graficaElasticidad').getContext('2d');
  miGrafica = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Curva de Ensayos (Esfuerzo vs Deformación)',
        data: [],
        borderColor: '#007bff',
        backgroundColor: 'rgba(0, 123, 255, 0.2)',
        pointRadius: 6,
        showLine: true
      }]
    },
    options: {
      responsive: true,
      scales: {
        x: {
          type: 'linear',
          position: 'bottom',
          title: { display: true, text: 'Estiramiento ΔL (cm)' }
        },
        y: {
          title: { display: true, text: 'Esfuerzo σ (MPa)' }
        }
      }
    }
  });
}

function actualizarFisica() {
  const matKey = document.getElementById('material').value;
  const mat = MATERIALES[matKey];
  const masa = parseFloat(document.getElementById('masa').value);
  const diametroMm = parseFloat(document.getElementById('diametro').value);

  const g = 9.81;
  const F_peso = masa * g;
  const radioM = (diametroMm / 1000) / 2;
  const areaM2 = Math.PI * Math.pow(radioM, 2);
  const L0 = dist(p1.x, p1.y, 250, 150);

  const dy = 70;
  const theta = Math.atan2(dy, (p2.x - p1.x) / 2);
  const tension = F_peso / (2 * Math.sin(theta));

  const esfuerzoPa = tension / areaM2;
  const esfuerzoMPa = esfuerzoPa / 1e6;
  const deltaLcm = ((tension * (L0 / 100)) / (areaM2 * mat.Y)) * 100;

  esfuerzoActualMPa = esfuerzoMPa;
  limiteActualMPa = mat.limite;

  const nuevoEstaRoto = esfuerzoMPa > mat.limite;

  if (nuevoEstaRoto && !estaRoto) {
    iniciarRuptura();
  } else if (!nuevoEstaRoto && estaRoto) {
    // El cable "se repara" al cambiar a parámetros seguros: reinicia el resorte visual
    rupturaData = null;
    estiramientoAnimadoPx = 0;
    velAnimVertical = 0;
    swayXAnimado = 0;
    velAnimHorizontal = 0;
  }
  estaRoto = nuevoEstaRoto;

  if (!estaRoto) {
    const nuevoObjetivoPx = Math.min(deltaLcm * 15, 180);
    if (objetivoAnteriorPx !== null) {
      const cambio = nuevoObjetivoPx - objetivoAnteriorPx;
      if (Math.abs(cambio) > 0.5) {
        // pequeño "impulso" al cambiar un parámetro: hace visible la naturaleza elástica
        velAnimVertical += constrain(cambio * 0.25, -20, 20);
        velAnimHorizontal += random(-3, 3);
      }
    }
    objetivoAnteriorPx = nuevoObjetivoPx;
    estiramientoObjetivoPx = nuevoObjetivoPx;
  }

  document.getElementById('m-tension').innerText = tension.toFixed(2);
  document.getElementById('m-esfuerzo').innerText = esfuerzoMPa.toFixed(2);
  document.getElementById('m-estiramiento').innerText = deltaLcm.toFixed(4);

  const estadoEl = document.getElementById('m-estado');
  let estadoTexto = "";
  if (estaRoto) {
    estadoTexto = "RUPTURA";
    estadoEl.innerText = "¡RUPTURA DEL CABLE!";
    estadoEl.className = "metric status broken";
  } else {
    estadoTexto = "ESTABLE";
    estadoEl.innerText = "ZONA ELÁSTICA (SEGURO)";
    estadoEl.className = "metric status safe";
  }

  guardarRegistroPrueba(matKey, masa, diametroMm, tension, esfuerzoMPa, deltaLcm, estadoTexto);
  actualizarPuntoGrafica(deltaLcm, esfuerzoMPa);
}

function iniciarRuptura() {
  const posYActual = 150 + estiramientoAnimadoPx;
  rupturaData = {
    pesoY: posYActual,
    pesoVelY: 0,
    anguloPeso: 0,
    velAnguloPeso: random(-0.06, 0.06),
    anguloIzq: 0,
    velAngIzq: random(0.08, 0.16),
    anguloDer: 0,
    velAngDer: random(-0.16, -0.08),
    tocoSuelo: false,
    particulas: []
  };
  for (let i = 0; i < 16; i++) {
    const ang = random(TWO_PI);
    const spd = random(2, 7);
    rupturaData.particulas.push({
      x: 250, y: posYActual,
      vx: cos(ang) * spd, vy: sin(ang) * spd - 2,
      vida: 255
    });
  }
}

function actualizarPuntoGrafica(xVal, yVal) {
  if (!miGrafica) return;
  if (miGrafica.data.datasets[0].data.length > 15) {
    miGrafica.data.datasets[0].data.shift();
  }
  miGrafica.data.datasets[0].data.push({ x: xVal, y: yVal });
  miGrafica.update();
}

function guardarRegistroPrueba(material, masa, diametro, tension, esfuerzo, estiramiento, estado) {
  historialPruebas.push({
    Fecha: new Date().toLocaleTimeString(),
    Material: material.toUpperCase(),
    Masa_kg: masa,
    Diametro_mm: diametro,
    Tension_N: tension.toFixed(2),
    Esfuerzo_MPa: esfuerzo.toFixed(2),
    Estiramiento_cm: estiramiento.toFixed(4),
    Estado: estado
  });
}

function descargarCSV() {
  if (historialPruebas.length === 0) {
    alert("No hay datos para exportar.");
    return;
  }
  const columnas = Object.keys(historialPruebas[0]);
  let contenidoCSV = columnas.join(",") + "\n";
  historialPruebas.forEach(fila => {
    contenidoCSV += Object.values(fila).join(",") + "\n";
  });
  const blob = new Blob([contenidoCSV], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.setAttribute("href", url);
  enlace.setAttribute("download", `reporte_laboratorio_fisica.csv`);
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
}

function draw() {
  background(245);
  const matKey = document.getElementById('material').value;
  const mat = MATERIALES[matKey];
  const diametro = parseFloat(document.getElementById('diametro').value);

  // Soportes fijos
  fill(100);
  rect(30, 50, 20, 300);
  rect(450, 50, 20, 300);

  if (!estaRoto) {
    // --- Resorte masa-amortiguador: hace que el cable "asiente" con un leve rebote ---
    const rigidez = 0.09;
    const amortiguacion = 0.72;

    const fuerzaV = (estiramientoObjetivoPx - estiramientoAnimadoPx) * rigidez;
    velAnimVertical = (velAnimVertical + fuerzaV) * amortiguacion;
    estiramientoAnimadoPx += velAnimVertical;

    const fuerzaH = (0 - swayXAnimado) * rigidez;
    velAnimHorizontal = (velAnimHorizontal + fuerzaH) * amortiguacion;
    swayXAnimado += velAnimHorizontal;

    // Vaivén de reposo sutil (más notorio en materiales flexibles como la goma)
    const flexibilidad = map(mat.Y, 0.05e9, 200e9, 1, 0.15, true);
    const vaivenReposo = sin(frameCount * 0.025) * 0.6 * flexibilidad;

    // Vibración leve cuando el esfuerzo se acerca al límite de ruptura
    const proximidadLimite = constrain(esfuerzoActualMPa / limiteActualMPa, 0, 1);
    const vibracion = proximidadLimite > 0.75
      ? random(-1, 1) * map(proximidadLimite, 0.75, 1, 0, 3)
      : 0;

    const posX = 250 + swayXAnimado + vibracion;
    const posY = 150 + estiramientoAnimadoPx + vaivenReposo + vibracion * 0.5;

    dibujarCableIntacto(mat.color, diametro, posX, posY);
    dibujarPesa(posX, posY, swayXAnimado * 0.02);
  } else {
    dibujarRuptura(diametro);
  }
}

function dibujarCableIntacto(color, diametro, posX, posY) {
  const grosor = map(diametro, 1, 20, 2, 8);

  push();
  stroke(color);
  strokeWeight(grosor);
  strokeCap(ROUND);
  line(p1.x + 10, p1.y, posX, posY);
  line(p2.x, p2.y, posX, posY);
  pop();

  // brillo sutil para dar sensación de tensión metálica
  push();
  stroke(255, 255, 255, 90);
  strokeWeight(max(1, grosor * 0.25));
  line(p1.x + 10, p1.y + 1, posX, posY + 1);
  line(p2.x, p2.y + 1, posX, posY + 1);
  pop();

  stroke(0);
  strokeWeight(1);
  fill(200);
  ellipse(posX, posY, 20, 20);
}

function dibujarPesa(posX, posY, inclinacion) {
  push();
  translate(posX, posY + 10);
  rotate(inclinacion);

  const grad = drawingContext.createLinearGradient(-20, 0, 20, 0);
  grad.addColorStop(0, '#2b2b2b');
  grad.addColorStop(0.5, '#5a5a5a');
  grad.addColorStop(1, '#2b2b2b');
  drawingContext.shadowBlur = 10;
  drawingContext.shadowOffsetY = 4;
  drawingContext.shadowColor = 'rgba(0,0,0,0.3)';
  drawingContext.fillStyle = grad;
  noStroke();
  rect(-20, 0, 40, 50, 6);
  drawingContext.shadowBlur = 0;
  drawingContext.shadowOffsetY = 0;

  fill(255);
  textAlign(CENTER, CENTER);
  textSize(13);
  text(document.getElementById('masa').value + " kg", 0, 25);
  pop();
}

function dibujarRuptura(diametro) {
  if (!rupturaData) return;
  const grosor = map(diametro, 1, 20, 2, 8);
  const d = rupturaData;
  const gravedad = 0.6;

  if (!d.tocoSuelo) {
    d.pesoVelY += gravedad;
    d.pesoY += d.pesoVelY;
    d.anguloPeso += d.velAnguloPeso;
    if (d.pesoY > 330) {
      d.pesoY = 330;
      d.pesoVelY *= -0.25;
      if (Math.abs(d.pesoVelY) < 1) d.tocoSuelo = true;
    }
  }
  d.anguloIzq += d.velAngIzq;
  d.velAngIzq *= 0.985;
  d.anguloDer += d.velAngDer;
  d.velAngDer *= 0.985;

  // Cable izquierdo, como un latigazo hacia el soporte
  push();
  stroke(220, 50, 50);
  strokeWeight(grosor);
  strokeCap(ROUND);
  translate(p1.x + 10, p1.y);
  rotate(d.anguloIzq);
  line(0, 0, 90, 40);
  pop();

  // Cable derecho
  push();
  stroke(220, 50, 50);
  strokeWeight(grosor);
  strokeCap(ROUND);
  translate(p2.x, p2.y);
  rotate(d.anguloDer);
  line(0, 0, -90, 40);
  pop();

  // Pesa en caída libre
  push();
  translate(250, d.pesoY);
  rotate(d.anguloPeso);
  fill(60);
  noStroke();
  rect(-20, 0, 40, 50, 5);
  pop();

  // Chispas del punto de ruptura
  for (let i = d.particulas.length - 1; i >= 0; i--) {
    const p = d.particulas[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15;
    p.vida -= 6;
    if (p.vida <= 0) { d.particulas.splice(i, 1); continue; }
    noStroke();
    fill(255, 90, 60, p.vida);
    ellipse(p.x, p.y, 4, 4);
  }
}

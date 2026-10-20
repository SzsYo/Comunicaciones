/* =============================================================================
   TaskTeam · script.js
   Lógica del tablero Kanban colaborativo.

   Idea rectora: la herramienta no solo organiza trabajo, también hace visible la
   conversación del equipo. Cada función está comentada explicando qué aporta a la
   comunicación asertiva, la retroalimentación constructiva y el trabajo en equipo.

   Índice:
     1. Configuración y estado
     2. Persistencia (localStorage)
     3. Utilidades (seguridad, fechas, avisos)
     4. Render del tablero y de las tarjetas
     5. Creación de tareas
     6. Movimiento de tareas (botones + arrastrar y soltar)
     7. Comentarios · comunicación asertiva
     8. Evaluación · retroalimentación constructiva
     9. Eliminación de tareas
    10. Eventos globales e inicio
   ============================================================================= */

/* ------------------------- 1. CONFIGURACIÓN Y ESTADO ------------------------- */

// Clave única en localStorage: permite que las tareas sobrevivan al recargar la
// página, de modo que el tablero siempre refleje el estado real del equipo.
var STORAGE_KEY = 'taskteam.tareas.v1';

// Flujo de trabajo acordado por el equipo (orden de las columnas del Kanban).
var COLUMNAS = ['todo', 'progress', 'review'];

// Etiquetas legibles para mostrar en la interfaz.
var NOMBRE_COLUMNA = {
  todo: 'Por Hacer',
  progress: 'En Progreso',
  review: 'Revisión / Completado'
};

// Estado en memoria. Se hidrata desde localStorage al iniciar.
var tareas = [];

// Referencias al DOM (se resuelven una sola vez para mejor rendimiento).
var listaColumnas = {};
var progressFill = document.getElementById('progressFill');
var progressBar = document.getElementById('progressBar');
var progressLabel = document.getElementById('progressLabel');
var progressCount = document.getElementById('progressCount');
var toastsBox = document.getElementById('toasts');

// Control de los modales abiertos actualmente.
var tareaEnComentario = null; // id de la tarea cuyo historial de comentarios se está viendo
var tareaEnRevision = null;   // id de la tarea que se está evaluando
var tareaAEliminar = null;    // id de la tarea pendiente de confirmación de borrado
var idArrastrado = null;      // id de la tarjeta que se está arrastrando

COLUMNAS.forEach(function (col) {
  listaColumnas[col] = document.getElementById('list-' + col);
});

/* ---------------------------- 2. PERSISTENCIA -------------------------------
   Guardar el tablero en localStorage es un acto de transparencia: cualquier
   integrante que abra la aplicación ve el mismo estado y las mismas
   conversaciones, lo que reduce suposiciones y retrabajo.                      */

/** Lee las tareas guardadas y valida la estructura antes de usarla. */
function cargarTareas() {
  try {
    var crudo = localStorage.getItem(STORAGE_KEY);
    if (!crudo) return [];
    var datos = JSON.parse(crudo);
    if (!Array.isArray(datos)) return [];
    // Normaliza cada registro para evitar errores si el formato cambió.
    return datos.map(function (t) {
      return {
        id: t.id || generarId(),
        titulo: t.titulo || 'Tarea sin título',
        descripcion: t.descripcion || '',
        responsable: t.responsable || 'Equipo TaskTeam',
        prioridad: t.prioridad || 'Media',
        fechaLimite: t.fechaLimite || '',
        columna: COLUMNAS.indexOf(t.columna) !== -1 ? t.columna : 'todo',
        comentarios: Array.isArray(t.comentarios) ? t.comentarios : [],
        evaluacion: t.evaluacion || null,
        creadoEn: t.creadoEn || new Date().toISOString()
      };
    });
  } catch (error) {
    // Si el dato almacenado está corrupto no se rompe la app: se avisa y se reinicia.
    mostrarToast('No se pudo leer el tablero guardado. Se inició un tablero nuevo.', 'warn');
    return [];
  }
}

/** Escribe el estado actual del tablero. */
function guardarTareas() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tareas));
  } catch (error) {
    mostrarToast('No fue posible guardar los cambios en este navegador.', 'error');
  }
}

/* ------------------------------ 3. UTILIDADES ------------------------------- */

/** Identificador único sencillo para cada tarea. */
function generarId() {
  return 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/**
 * Escapa el texto ingresado por el usuario antes de insertarlo en el HTML.
 * Evita que un comentario con etiquetas rompa la interfaz entre compañeros.
 */
function escapar(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Fecha legible en formato local (Bogotá / configuración del navegador). */
function formatearFecha(iso) {
  if (!iso) return '';
  var fecha = new Date(iso);
  if (isNaN(fecha.getTime())) return '';
  return fecha.toLocaleString('es-CO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

/** Fecha límite en formato corto (solo día). */
function formatearDia(valor) {
  if (!valor) return '';
  var partes = valor.split('-');
  if (partes.length !== 3) return valor;
  return partes[2] + '/' + partes[1] + '/' + partes[0];
}

/** Indica si una fecha límite ya venció respecto a hoy. */
function estaVencida(valor) {
  if (!valor) return false;
  var limite = new Date(valor + 'T23:59:59');
  return !isNaN(limite.getTime()) && limite < new Date();
}

/**
 * Aviso breve al usuario. Se usa para confirmar acciones y para dar
 * retroalimentación inmediata al equipo sobre lo que acaba de ocurrir.
 */
function mostrarToast(mensaje, tipo) {
  var el = document.createElement('div');
  el.className = 'toast' + (tipo ? ' toast--' + tipo : '');
  el.textContent = mensaje;
  toastsBox.appendChild(el);
  setTimeout(function () {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(function () { el.remove(); }, 300);
  }, 3200);
}

/* --------------------------- 4. RENDER DEL TABLERO ---------------------------
   Renderizar siempre desde el estado central (tareas) evita que la interfaz y
   los datos se contradigan: todos ven exactamente lo mismo, condición necesaria
   para coordinarse sin fricciones.                                            */

/** Redibuja las tres columnas, los contadores y la barra de avance. */
function render() {
  COLUMNAS.forEach(function (col) {
    var contenedor = listaColumnas[col];
    var delGrupo = tareas.filter(function (t) { return t.columna === col; });

    contenedor.innerHTML = '';

    if (delGrupo.length === 0) {
      var vacio = document.createElement('div');
      vacio.className = 'empty';
      vacio.textContent = mensajeVacio(col);
      contenedor.appendChild(vacio);
    } else {
      delGrupo.forEach(function (tarea) {
        contenedor.appendChild(crearTarjeta(tarea));
      });
    }

    // Contador visible de cada columna.
    document.getElementById('count-' + col).textContent = delGrupo.length;
  });

  actualizarProgreso();
}

/** Mensaje orientador cuando una columna está vacía (invita a la acción). */
function mensajeVacio(col) {
  if (col === 'todo') return 'Sin pendientes. Agrega la siguiente tarea del equipo.';
  if (col === 'progress') return 'Nada en curso todavía. Mueve una tarea para iniciar.';
  return 'Aquí llegarán las tareas listas para revisar y cerrar.';
}

/** Construye el elemento HTML de una tarjeta de tarea. */
function crearTarjeta(tarea) {
  var card = document.createElement('article');
  card.className = 'card' + (tarea.evaluacion ? ' is-done' : '');
  card.dataset.id = tarea.id;
  card.dataset.priority = tarea.prioridad;
  card.draggable = true; // habilita arrastrar y soltar entre columnas
  card.setAttribute('role', 'listitem');

  // --- Comentarios visibles dentro de la tarjeta: mostrar el diálogo en contexto
  var comentariosHtml = '';
  if (tarea.comentarios.length > 0) {
    comentariosHtml = '<div class="card__comments">' +
      tarea.comentarios.slice(-2).map(function (c) {
        return '<div class="comment">' +
                 '<span class="comment__meta">' + escapar(c.autor) + ' · ' + escapar(formatearFecha(c.fecha)) + '</span>' +
                 escapar(c.texto) +
               '</div>';
      }).join('') +
      (tarea.comentarios.length > 2
        ? '<div class="comment comment__empty">+' + (tarea.comentarios.length - 2) + ' comentario(s) anteriores</div>'
        : '') +
      '</div>';
  }

  // --- Evaluación: la nota de retroalimentación queda a la vista de todos
  var feedbackHtml = '';
  if (tarea.evaluacion) {
    feedbackHtml = '<div class="feedback">' +
                     '<span class="feedback__meta">Retroalimentación · ' + escapar(tarea.evaluacion.autor) + '</span>' +
                     escapar(tarea.evaluacion.texto) +
                   '</div>';
  }

  card.innerHTML =
    '<div class="card__head">' +
      '<h3 class="card__title">' + escapar(tarea.titulo) + '</h3>' +
    '</div>' +
    (tarea.descripcion ? '<p class="card__desc">' + escapar(tarea.descripcion) + '</p>' : '') +
    '<div class="card__meta">' +
      '<span class="tag tag--owner" title="Responsable">👤 ' + escapar(tarea.responsable) + '</span>' +
      '<span class="tag tag--priority-' + escapar(tarea.prioridad) + '">Prioridad ' + escapar(tarea.prioridad) + '</span>' +
      (tarea.fechaLimite
        ? '<span class="tag tag--due' + (estaVencida(tarea.fechaLimite) && !tarea.evaluacion ? ' is-late' : '') + '">' +
            (estaVencida(tarea.fechaLimite) && !tarea.evaluacion ? '⏰ Venció ' : '📅 ') + escapar(formatearDia(tarea.fechaLimite)) +
          '</span>'
        : '') +
      (tarea.comentarios.length > 0 ? '<span class="tag">💬 ' + tarea.comentarios.length + '</span>' : '') +
    '</div>' +
    comentariosHtml +
    feedbackHtml +
    '<div class="card__footer">' +
      // Comunicación asertiva: abrir el hilo de comentarios de la tarea
      '<button type="button" class="card-btn card-btn--accent" data-action="comment">💬 Añadir comentario</button>' +
      botonesDeFlujo(tarea) +
      '<span class="spacer"></span>' +
      '<button type="button" class="card-btn card-btn--danger" data-action="delete" title="Eliminar tarea">🗑</button>' +
    '</div>';

  return card;
}

/**
 * Botones de avance según la columna. Se nombran con lenguaje de equipo
 * ("Iniciar", "Enviar a revisión", "Devolver") para que mover trabajo no se
 * perciba como señalamiento sino como parte natural del flujo acordado.
 */
function botonesDeFlujo(tarea) {
  if (tarea.columna === 'todo') {
    return '<button type="button" class="card-btn" data-action="move" data-to="progress">▶ Iniciar</button>';
  }
  if (tarea.columna === 'progress') {
    return '<button type="button" class="card-btn" data-action="move" data-to="review">→ Enviar a revisión</button>' +
           '<button type="button" class="card-btn" data-action="move" data-to="todo">↩ Devolver</button>';
  }
  // Columna de revisión: evaluar antes de cerrar; si ya se evaluó, permitir reabrir
  return tarea.evaluacion
    ? '<button type="button" class="card-btn" data-action="move" data-to="progress">↺ Reabrir</button>'
    : '<button type="button" class="card-btn card-btn--review" data-action="evaluate">✎ Evaluar</button>' +
      '<button type="button" class="card-btn" data-action="move" data-to="progress">↩ Devolver</button>';
}

/** Barra de avance global: hace tangible el progreso colectivo de la semana. */
function actualizarProgreso() {
  var total = tareas.length;
  var cerradas = tareas.filter(function (t) { return t.evaluacion; }).length;
  var porcentaje = total === 0 ? 0 : Math.round((cerradas / total) * 100);

  progressFill.style.width = porcentaje + '%';
  progressLabel.textContent = porcentaje + '% completado';
  progressCount.textContent = cerradas + ' de ' + total + ' tareas evaluadas y cerradas';
  progressBar.setAttribute('aria-valuenow', String(porcentaje));
}

/* --------------------------- 5. CREACIÓN DE TAREAS ---------------------------
   Toda tarea entra con responsable y fecha: el compromiso se declara desde el
   inicio y el equipo sabe a quién preguntar, evitando el clásico "pensé que lo
   hacía otro".                                                                */

document.getElementById('taskForm').addEventListener('submit', function (evento) {
  evento.preventDefault();

  var titulo = document.getElementById('taskTitle').value.trim();
  var descripcion = document.getElementById('taskDesc').value.trim();
  var responsable = document.getElementById('taskAssignee').value;
  var prioridad = document.getElementById('taskPriority').value;
  var fechaLimite = document.getElementById('taskDue').value;

  // Validación mínima antes de crear la tarea.
  if (titulo.length < 3) {
    mostrarToast('Escribe un título de al menos 3 caracteres.', 'warn');
    document.getElementById('taskTitle').focus();
    return;
  }
  if (!responsable) {
    mostrarToast('Selecciona un responsable para la tarea.', 'warn');
    document.getElementById('taskAssignee').focus();
    return;
  }

  var nueva = {
    id: generarId(),
    titulo: titulo,
    descripcion: descripcion,
    responsable: responsable,
    prioridad: prioridad,
    fechaLimite: fechaLimite,
    columna: 'todo', // toda tarea nace en "Por Hacer"
    comentarios: [],
    evaluacion: null,
    creadoEn: new Date().toISOString()
  };

  tareas.push(nueva);
  guardarTareas();
  render();

  this.reset();
  document.getElementById('taskPriority').value = 'Media';
  document.getElementById('taskTitle').focus();

  mostrarToast('Tarea asignada a ' + nueva.responsable + '.', 'ok');
});

/* ------------------------- 6. MOVIMIENTO DE TAREAS ------------------------- */

/** Cambia una tarea de columna y deja constancia del cambio en el tablero. */
function moverTarea(id, destino) {
  var tarea = buscarTarea(id);
  if (!tarea || COLUMNAS.indexOf(destino) === -1) return;

  if (tarea.evaluacion && destino !== 'progress') return; // una tarea cerrada solo se reabre
  if (tarea.columna === destino) return;

  var origen = tarea.columna;
  tarea.columna = destino;

  // Al reabrir una tarea se limpia la evaluación para volver a revisarla con criterio.
  if (destino === 'progress' && tarea.evaluacion) {
    tarea.evaluacion = null;
  }

  guardarTareas();
  render();
  mostrarToast('"' + tarea.titulo + '": ' + NOMBRE_COLUMNA[origen] + ' → ' + NOMBRE_COLUMNA[destino] + '.', 'ok');
}

/** Busca una tarea por id dentro del estado. */
function buscarTarea(id) {
  for (var i = 0; i < tareas.length; i++) {
    if (tareas[i].id === id) return tareas[i];
  }
  return null;
}

/* --- Arrastrar y soltar: gesto rápido para actualizar el estado del trabajo --- */

// Delegación de eventos: un solo listener para todas las tarjetas presentes y futuras.
document.querySelector('.board').addEventListener('dragstart', function (evento) {
  var card = evento.target.closest('.card');
  if (!card) return;
  idArrastrado = card.dataset.id;
  card.classList.add('is-dragging');
  evento.dataTransfer.effectAllowed = 'move';
  evento.dataTransfer.setData('text/plain', idArrastrado);
});

document.querySelector('.board').addEventListener('dragend', function (evento) {
  var card = evento.target.closest('.card');
  if (card) card.classList.remove('is-dragging');
  idArrastrado = null;
  limpiarZonas();
});

// Resalta la columna bajo el cursor para comunicar visualmente dónde caerá la tarea.
document.querySelectorAll('[data-dropzone]').forEach(function (zona) {
  zona.addEventListener('dragover', function (evento) {
    evento.preventDefault();
    evento.dataTransfer.dropEffect = 'move';
    zona.closest('.column').classList.add('is-drop-target');
  });

  zona.addEventListener('dragleave', function () {
    zona.closest('.column').classList.remove('is-drop-target');
  });

  zona.addEventListener('drop', function (evento) {
    evento.preventDefault();
    var id = idArrastrado || evento.dataTransfer.getData('text/plain');
    limpiarZonas();
    if (id) moverTarea(id, zona.dataset.dropzone);
  });
});

/** Quita el resaltado de todas las columnas. */
function limpiarZonas() {
  document.querySelectorAll('.column').forEach(function (c) {
    c.classList.remove('is-drop-target');
  });
}

/* ------------------------ 7. COMENTARIOS (COMUNICACIÓN) ----------------------
   Abrir el hilo de una tarea y escribir con autor visible transforma dudas
   sueltas en acuerdos registrados: la comunicación queda clara, respetuosa y
   consultable por todo el equipo.                                            */

var commentModal = document.getElementById('commentModal');
var commentList = document.getElementById('commentList');
var commentTaskTitle = document.getElementById('commentTaskTitle');

/** Muestra el historial completo de comentarios de una tarea. */
function abrirComentarios(id) {
  var tarea = buscarTarea(id);
  if (!tarea) return;

  tareaEnComentario = id;
  commentTaskTitle.textContent = tarea.titulo + ' · Responsable: ' + tarea.responsable;

  if (tarea.comentarios.length === 0) {
    commentList.innerHTML = '<li class="comment comment__empty">Aún no hay comentarios. Sé el primero en compartir un avance, una duda o un bloqueo.</li>';
  } else {
    commentList.innerHTML = tarea.comentarios.map(function (c) {
      return '<li class="comment">' +
               '<span class="comment__meta">' + escapar(c.autor) + ' · ' + escapar(formatearFecha(c.fecha)) + '</span>' +
               escapar(c.texto) +
             '</li>';
    }).join('');
  }

  abrirModal(commentModal);
  document.getElementById('commentText').focus();
}

document.getElementById('commentForm').addEventListener('submit', function (evento) {
  evento.preventDefault();

  var tarea = buscarTarea(tareaEnComentario);
  if (!tarea) return;

  var autor = document.getElementById('commentAuthor').value;
  var texto = document.getElementById('commentText').value.trim();

  if (texto.length < 2) {
    mostrarToast('Escribe tu comentario antes de publicarlo.', 'warn');
    return;
  }

  tarea.comentarios.push({ autor: autor, texto: texto, fecha: new Date().toISOString() });
  guardarTareas();
  render();

  this.reset();
  document.getElementById('commentText').value = '';
  abrirComentarios(tarea.id); // refresca el historial dentro del modal abierto
  mostrarToast('Comentario publicado. El equipo ya puede verlo.', 'ok');
});

/* -------------------- 8. EVALUACIÓN (RETROALIMENTACIÓN) ----------------------
   La columna de revisión obliga a dejar una nota antes de cerrar. Esa pausa
   convierte la crítica en aprendizaje: se reconocen logros, se proponen mejoras
   concretas y se evita que los conflictos se acumulen sin resolverse.        */

var reviewModal = document.getElementById('reviewModal');
var reviewTaskTitle = document.getElementById('reviewTaskTitle');

/** Abre el formulario modal de evaluación para una tarea en revisión. */
function abrirEvaluacion(id) {
  var tarea = buscarTarea(id);
  if (!tarea) return;

  tareaEnRevision = id;
  reviewTaskTitle.textContent = tarea.titulo + ' · Responsable: ' + tarea.responsable;
  document.getElementById('reviewText').value = tarea.evaluacion ? tarea.evaluacion.texto : '';

  abrirModal(reviewModal);
  document.getElementById('reviewText').focus();
}

document.getElementById('reviewForm').addEventListener('submit', function (evento) {
  evento.preventDefault();

  var tarea = buscarTarea(tareaEnRevision);
  if (!tarea) return;

  var autor = document.getElementById('reviewAuthor').value;
  var texto = document.getElementById('reviewText').value.trim();

  if (texto.length < 5) {
    mostrarToast('La retroalimentación debe ser concreta (mínimo 5 caracteres).', 'warn');
    return;
  }

  tarea.evaluacion = { autor: autor, texto: texto, fecha: new Date().toISOString() };
  tarea.columna = 'review'; // queda cerrada dentro de Revisión / Completado
  guardarTareas();
  render();

  this.reset();
  cerrarModal(reviewModal);
  mostrarToast('Evaluación guardada. Tarea cerrada con retroalimentación.', 'ok');
});

/* -------------------------- 9. ELIMINAR UNA TAREA --------------------------- */

var confirmModal = document.getElementById('confirmModal');
var confirmText = document.getElementById('confirmText');

/** Pide confirmación antes de borrar: eliminar trabajo ajeno exige consenso. */
function pedirEliminar(id) {
  var tarea = buscarTarea(id);
  if (!tarea) return;

  tareaAEliminar = id;
  confirmText.textContent = 'Se eliminará "' + tarea.titulo + '" junto con sus comentarios. Esta acción no se puede deshacer.';
  abrirModal(confirmModal);
}

document.getElementById('confirmDelete').addEventListener('click', function () {
  var tarea = buscarTarea(tareaAEliminar);
  if (!tarea) return;

  tareas = tareas.filter(function (t) { return t.id !== tareaAEliminar; });
  guardarTareas();
  render();
  cerrarModal(confirmModal);
  tareaAEliminar = null;
  mostrarToast('Tarea eliminada del tablero.', 'warn');
});

/* --------------------------- 10. EVENTOS GLOBALES ---------------------------
   Delegación de clics en el tablero: un único punto que decide qué acción
   realizar, lo que simplifica el mantenimiento y mantiene el comportamiento
   consistente para todo el equipo.                                          */

document.querySelector('.board').addEventListener('click', function (evento) {
  var boton = evento.target.closest('[data-action]');
  if (!boton) return;

  var card = boton.closest('.card');
  if (!card) return;

  var id = card.dataset.id;
  var accion = boton.dataset.action;

  if (accion === 'comment') abrirComentarios(id);
  else if (accion === 'evaluate') abrirEvaluacion(id);
  else if (accion === 'move') moverTarea(id, boton.dataset.to);
  else if (accion === 'delete') pedirEliminar(id);
});

/** Abre un modal y bloquea el scroll del fondo. */
function abrirModal(modal) {
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

/** Cierra un modal y devuelve el scroll a la página. */
function cerrarModal(modal) {
  modal.hidden = true;
  document.body.style.overflow = '';
  if (modal === commentModal) tareaEnComentario = null;
  if (modal === reviewModal) tareaEnRevision = null;
  if (modal === confirmModal) tareaAEliminar = null;
}

// Cierre mediante el fondo oscuro o los botones con data-close-modal.
document.querySelectorAll('.modal').forEach(function (modal) {
  modal.addEventListener('click', function (evento) {
    if (evento.target.closest('[data-close-modal]')) cerrarModal(modal);
  });
});

// Accesibilidad: la tecla Escape cierra la ventana activa.
document.addEventListener('keydown', function (evento) {
  if (evento.key !== 'Escape') return;
  [commentModal, reviewModal, confirmModal].forEach(function (modal) {
    if (!modal.hidden) cerrarModal(modal);
  });
});

/* ------------------------------ ARRANQUE ----------------------------------- */

/** Inicia la aplicación: recupera el tablero guardado y lo dibuja. */
function iniciar() {
  tareas = cargarTareas();
  render();

  if (tareas.length > 0) {
    mostrarToast('Tablero restaurado: ' + tareas.length + ' tarea(s) del equipo.', 'ok');
  }
}

iniciar();

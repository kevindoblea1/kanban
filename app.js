/* Kanban simple, nivel estudiante.
   - Columnas: backlog, todo, inprogress, review, done
   - CRUD: crear, editar, eliminar
   - Drag & Drop para mover columnas
   - Persistencia: Firebase Firestore
   - Exportar/Importar JSON
*/

const $ = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

// Initialize Cloud Firestore and get a reference to the service
const db = firebase.firestore();
const tasksCollection = db.collection("tasks");

const dialog = $("#dlgTask");
const form = $("#frmTask");
const inpId = $("#taskId");
const inpTitle = $("#taskTitle");
const inpDesc = $("#taskDesc");
const inpOwner = $("#taskOwner");
const inpDue = $("#taskDue");
const inpPriority = $("#taskPriority");
const selStatus = $("#taskStatus");
const dlgTitle = $("#dlgTitle");

const search = $("#search");

const columns = {
  backlog: $("#col-backlog"),
  todo: $("#col-todo"),
  inprogress: $("#col-inprogress"),
  review: $("#col-review"),
  done: $("#col-done"),
};

let tasks = [];

// --------- Init UI ---------
async function init() {
  tasks = await loadTasks();
  render();
  attachDnD();
  $("#btnAdd").addEventListener("click", openNew);
  $("#btnExport").addEventListener("click", exportJSON);
  $("#btnReset").addEventListener("click", () => { if(confirm("¿Limpiar tablero y restaurar demo?")) resetDemo(); });
  $("#fileImport").addEventListener("change", importJSON);
  search.addEventListener("input", render);
}
init();


// --------- CRUD ---------
function openNew(){
  dlgTitle.textContent = "Nueva tarea";
  inpId.value = "";
  form.reset();
  selStatus.value = "backlog";
  if (!dialog.open) dialog.showModal();
}
function openEdit(task){
  dlgTitle.textContent = "Editar tarea";
  inpId.value = task.id;
  inpTitle.value = task.title;
  inpDesc.value = task.description || "";
  inpOwner.value = task.owner || "";
  inpDue.value = task.dueDate ? task.dueDate.slice(0,10) : "";
  inpPriority.value = task.priority || "media";
  selStatus.value = task.status;
  if (!dialog.open) dialog.showModal();
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const data = {
    id: inpId.value || crypto.randomUUID(),
    title: inpTitle.value.trim(),
    description: inpDesc.value.trim(),
    owner: inpOwner.value.trim(),
    dueDate: inpDue.value ? new Date(inpDue.value).toISOString() : "",
    priority: inpPriority.value,
    status: selStatus.value
  };
  if (!data.title){ alert("El título es obligatorio."); return; }

  const i = tasks.findIndex(t => t.id === data.id);
  if (i >= 0) tasks[i] = data; else tasks.push(data);

  await saveTasks();
  render();
  dialog.close();
});

dialog.addEventListener("close", () => form.reset());

async function removeTask(id){
  if (!confirm("¿Eliminar esta tarea?")) return;
  tasks = tasks.filter(t => t.id !== id);
  await saveTasks();
  render();
}

// --------- Render ---------
function render(){
  // Limpia columnas
  Object.values(columns).forEach(col => col.innerHTML = "");

  const q = search.value.trim().toLowerCase();
  const filtered = tasks.filter(t => {
    if (!q) return true;
    return (t.title?.toLowerCase().includes(q) || t.owner?.toLowerCase().includes(q));
  });

  // Orden: prioridad alta > media > baja, luego fecha
  const prioWeight = { alta:0, media:1, baja:2 };
  filtered.sort((a,b) => (prioWeight[a.priority||"media"] - prioWeight[b.priority||"media"])
                      || (a.dueDate||"").localeCompare(b.dueDate||""));

  for (const t of filtered){
    const card = createCard(t);
    columns[t.status]?.appendChild(card);
  }
}

function createCard(t){
  const tpl = $("#tplCard").content.cloneNode(true);
  const art = tpl.querySelector(".card");
  art.dataset.id = t.id;
  tpl.querySelector(".priority").textContent = (t.priority||"media");
  tpl.querySelector(".priority").dataset.p = (t.priority||"media");
  tpl.querySelector(".title").textContent = t.title;
  tpl.querySelector(".desc").textContent = t.description||"";
  tpl.querySelector(".owner").textContent = t.owner ? "👤 " + t.owner : "";
  const due = t.dueDate ? new Date(t.dueDate) : null;
  tpl.querySelector(".due").textContent = due ? ("📅 " + due.toLocaleDateString()) : "";

  // Edit/Delete actions
  tpl.querySelector(".edit").addEventListener("click", () => openEdit(t));
  tpl.querySelector(".delete").addEventListener("click", () => removeTask(t.id));

  // dnd hooks
  art.addEventListener("dragstart", dragStart);
  art.addEventListener("dragend", dragEnd);
  return tpl;
}

// --------- Drag & Drop ---------
let draggingId = null;
function dragStart(ev){
  const card = ev.currentTarget;
  card.classList.add("dragging");
  draggingId = card.dataset.id;
  ev.dataTransfer.setData("text/plain", draggingId);
  ev.dataTransfer.effectAllowed = "move";
}
function dragEnd(ev){
  ev.currentTarget.classList.remove("dragging");
  draggingId = null;
}
function attachDnD(){
  $$(".dropzone").forEach(zone => {
    zone.addEventListener("dragover", (ev)=>{ ev.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", ()=> zone.classList.remove("dragover"));
    zone.addEventListener("drop", async (ev)=>{
      ev.preventDefault();
      zone.classList.remove("dragover");
      const id = draggingId || ev.dataTransfer.getData("text/plain");
      const t = tasks.find(x => x.id === id);
      if (!t) return;
      const status = zone.parentElement.getAttribute("data-status");
      t.status = status;
      await saveTasks();
      render();
    });
  });
}

// --------- Persistencia (Firestore) ---------
async function loadTasks() {
  try {
    const snapshot = await tasksCollection.get();
    if (snapshot.empty) {
        console.log("No tasks found, seeding with demo data.");
        const demoTasks = seedDemo();
        tasks = demoTasks;
        await saveTasks(); // Save the demo tasks to Firestore
        return demoTasks;
    }
    return snapshot.docs.map(doc => doc.data());
  } catch (e) {
    console.error("Error loading tasks from Firestore. Using demo data.", e);
    alert("No se pudo conectar con Firestore. Se cargarán datos de demostración.");
    return seedDemo();
  }
}

async function saveTasks() {
  try {
    const batch = db.batch();

    // Get all documents in the collection to delete them
    const snapshot = await tasksCollection.get();
    snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
    });

    // Add all current tasks from the local array
    tasks.forEach(task => {
        const docRef = tasksCollection.doc(task.id);
        batch.set(docRef, task);
    });

    await batch.commit();
  } catch (e) {
    console.error("Could not save tasks to Firestore.", e);
    alert("No se pudo guardar en Firestore. Tus cambios podrían no persistir.");
  }
}


async function resetDemo(){
  tasks = seedDemo();
  await saveTasks();
  render();
}

function seedDemo(){
  const today = new Date(); 
  const plus = (d)=> new Date(today.getTime() + d*86400000).toISOString();
  return [
    { id: crypto.randomUUID(), title: "Configurar proyecto MAUI", description:"Crear solución y targets Windows/Android.", owner:"A", dueDate: plus(1), priority:"alta", status:"backlog" },
    { id: crypto.randomUUID(), title: "Modelo ShoppingItem", description:"Id, Name, IsPurchased", owner:"B", dueDate: plus(2), priority:"media", status:"backlog" },
    { id: crypto.randomUUID(), title: "Servicio SQLite", description:"Load/Save con sqlite-net-pcl", owner:"B", dueDate: plus(3), priority:"alta", status:"todo" },
    { id: crypto.randomUUID(), title: "ViewModel CRUD", description:"Add/Edit/Delete/Toggle + Filter", owner:"C", dueDate: plus(4), priority:"alta", status:"todo" },
    { id: crypto.randomUUID(), title: "UI XAML con Swipe", description:"Entry, SearchBar, CollectionView", owner:"D", dueDate: plus(5), priority:"media", status:"inprogress" },
    { id: crypto.randomUUID(), title: "QA y README", description:"Plan de pruebas + capturas", owner:"E", dueDate: plus(6), priority:"baja", status:"review" },
    { id: crypto.randomUUID(), title: "Alpha Demo", description:"Windows + Android corriendo", owner:"Equipo", dueDate: plus(7), priority:"alta", status:"done" },
  ];
}

// --------- Exportar / Importar ---------
function exportJSON(){
  const blob = new Blob([JSON.stringify(tasks, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kanban_tasks.json";
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
}

function importJSON(ev){
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try{
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error("Formato inválido");
      // saneamos campos
      tasks = data.map(t => ({
        id: t.id || crypto.randomUUID(),
        title: String(t.title||"").slice(0,100),
        description: String(t.description||""),
        owner: String(t.owner||""),
        dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : "",
        priority: ["alta","media","baja"].includes(t.priority) ? t.priority : "media",
        status: ["backlog","todo","inprogress","review","done"].includes(t.status) ? t.status : "backlog"
      }));
      await saveTasks();
      render();
      ev.target.value = ""; // reset input
    }catch(err){
      alert("No se pudo importar: " + err.message);
    }
  };
  reader.readAsText(file);
}

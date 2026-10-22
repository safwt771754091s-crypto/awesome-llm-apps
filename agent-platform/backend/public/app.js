(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const tokenKey = "agent-platform.owner-token";
$("token").value = sessionStorage.getItem(tokenKey) || "";
function token() { return $("token").value.trim() || sessionStorage.getItem(tokenKey) || ""; }
function setStatus(text) { $("taskStatus").textContent = text; }
function escapeText(value) { return String(value ?? ""); }
function renderPlan(plan) {
  const root = $("result");
  root.replaceChildren();
  const summary = document.createElement("p");
  summary.textContent = plan.summary || "تم إنشاء الخطة.";
  root.append(summary);
  for (const phase of (plan.phases || [])) {
    const section = document.createElement("section");
    section.className = "phase";
    const heading = document.createElement("h3");
    heading.textContent = phase.name || "مرحلة";
    section.append(heading);
    for (const [label, items] of [["المهام", phase.tasks], ["معايير القبول", phase.acceptance_criteria]]) {
      if (!Array.isArray(items) || !items.length) continue;
      const title = document.createElement("strong"); title.textContent = label; section.append(title);
      const list = document.createElement("ul");
      for (const item of items) { const li = document.createElement("li"); li.textContent = escapeText(item); list.append(li); }
      section.append(list);
    }
    root.append(section);
  }
  for (const [label, items] of [["الافتراضات",plan.assumptions],["المخاطر",plan.risks],["التكاملات المطلوبة",plan.required_integrations],["الموافقات المطلوبة",plan.human_approvals]]) {
    if (!Array.isArray(items) || !items.length) continue;
    const section = document.createElement("section"); section.className = "phase";
    const h = document.createElement("h3"); h.textContent = label; section.append(h);
    const ul = document.createElement("ul");
    for (const item of items) { const li=document.createElement("li"); li.textContent=escapeText(item); ul.append(li); }
    section.append(ul); root.append(section);
  }
}
async function api(path, options={}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type":"application/json", "Authorization":"Bearer "+token(), ...(options.headers || {}) }
  });
  const data = await response.json().catch(()=>({error:"invalid_response"}));
  if (!response.ok) throw new Error(data.error || ("HTTP "+response.status));
  return data;
}
$("saveToken").addEventListener("click", () => {
  if (token().length < 32) return alert("رمز المالك يجب أن يكون 32 حرفًا على الأقل.");
  sessionStorage.setItem(tokenKey, token());
  alert("تم حفظ الرمز في جلسة المتصفح الحالية فقط.");
});
$("check").addEventListener("click", async () => {
  try {
    const response = await fetch("/healthz");
    const data = await response.json();
    $("connection").textContent = data.status === "ok" ? "الخادم وقاعدة البيانات متصلان" : "الخادم يحتاج إعدادًا";
    if (!response.ok) throw new Error((data.missing || [data.database || data.status]).join(", "));
    $("connection").style.color = "#86efac";
  } catch (error) {
    $("connection").textContent = "تعذر الاتصال: " + error.message;
    $("connection").style.color = "#fca5a5";
  }
});
$("taskForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  $("submit").disabled = true;
  $("submit").textContent = "جارٍ إنشاء الخطة...";
  setStatus("قيد المعالجة");
  $("result").textContent = "يجري إرسال المهمة إلى الخادم...";
  try {
    if (token().length < 32) throw new Error("أدخل رمز المالك الصحيح أولًا.");
    const data = await api("/api/tasks", {method:"POST",body:JSON.stringify({prompt,type:$("type").value})});
    renderPlan(data.plan);
    $("taskId").value = data.taskId;
    setStatus("اكتملت الخطة فقط");
  } catch (error) {
    $("result").textContent = "لم تنجح المهمة: " + error.message;
    setStatus("تعذر التنفيذ");
  } finally {
    $("submit").disabled = false;
    $("submit").textContent = "حلّل الطلب وأنشئ خطة";
  }
});
$("lookupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("taskId").value.trim();
  if (!id) return;
  $("lookupResult").textContent = "جارٍ البحث...";
  try {
    const data = await api("/api/tasks/"+encodeURIComponent(id));
    const task = data.task;
    if (task.plan) renderPlan(task.plan);
    else $("result").textContent = "حالة المهمة: " + task.status + " — " + (task.error_code || "");
    $("lookupResult").textContent = "الحالة: " + task.status + " · النوع: " + task.task_type + " · التاريخ: " + task.created_at;
    setStatus(task.status);
  } catch (error) { $("lookupResult").textContent = "تعذر جلب المهمة: " + error.message; }
});
})();
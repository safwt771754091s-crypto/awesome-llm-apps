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
  const name = $("projectName").value.trim() || "مشروعي";
  if (!prompt) return;
  $("submit").disabled = true;
  $("submit").textContent = "جارٍ كتابة ملفات المشروع...";
  setStatus("يتم إنشاء ملفات فعلية");
  $("result").textContent = "يرسل الطلب إلى وكيل البرمجة لإنشاء ملفات المصدر...";
  try {
    if (token().length < 32) throw new Error("أدخل رمز المالك الصحيح أولًا.");
    const data = await api("/api/projects/generate", {method:"POST",body:JSON.stringify({prompt,name})});
    $("taskId").value = data.projectId;
    const root = $("result");
    root.replaceChildren();
    const summary = document.createElement("p");
    summary.textContent = data.summary || "اكتمل توليد الملفات.";
    root.append(summary);
    const note = document.createElement("p");
    note.textContent = "تم إنشاء ملفات المصدر وحفظها. لم يتم تشغيل الشيفرة أو اختبار البناء أو نشر التطبيق بعد.";
    root.append(note);
    const list = document.createElement("ul");
    for (const file of (data.files || [])) {
      const li = document.createElement("li");
      li.textContent = file.path + " — " + file.size + " بايت";
      list.append(li);
    }
    root.append(list);
    const details = document.createElement("p");
    details.textContent = "معرّف المشروع: " + data.projectId;
    root.append(details);
    setStatus("تم إنشاء الملفات — لم يُختبر البناء");
    $("lookupResult").textContent = "استخدم «عرض ملفات المشروع» لاسترجاع محتويات الملفات.";
  } catch (error) {
    $("result").textContent = "لم تنجح عملية إنشاء الملفات: " + error.message;
    setStatus("تعذر إنشاء المشروع");
  } finally {
    $("submit").disabled = false;
    $("submit").textContent = "اكتب ملفات التطبيق";
  }
});
$("lookupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("taskId").value.trim();
  if (!id) return;
  $("lookupResult").textContent = "جارٍ جلب ملفات المشروع...";
  try {
    const data = await api("/api/projects/"+encodeURIComponent(id)+"/files");
    const project = data.project;
    const root = $("result");
    root.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = project.name + " — " + project.status;
    root.append(heading);
    const summary = document.createElement("p");
    summary.textContent = project.summary;
    root.append(summary);
    for (const file of (project.files || [])) {
      const section = document.createElement("section");
      section.className = "phase";
      const title = document.createElement("h3");
      title.textContent = file.path;
      section.append(title);
      const pre = document.createElement("pre");
      pre.style.whiteSpace = "pre-wrap";
      pre.style.overflowWrap = "anywhere";
      pre.textContent = file.content;
      section.append(pre);
      const copy = document.createElement("button");
      copy.className = "secondary";
      copy.type = "button";
      copy.textContent = "نسخ محتوى الملف";
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(file.content); copy.textContent = "تم النسخ"; }
        catch { copy.textContent = "تعذر النسخ — حدّد النص يدويًا"; }
      });
      section.append(copy);
      root.append(section);
    }
    $("lookupResult").textContent = "المشروع: " + project.name + " · الحالة: " + project.status + " · الملفات: " + (project.files || []).length;
    setStatus("تم استرجاع ملفات المصدر");
  } catch (error) {
    $("lookupResult").textContent = "تعذر جلب المشروع: " + error.message;
  }
});
})();

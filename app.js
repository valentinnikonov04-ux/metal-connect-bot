const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const state = {
  role: localStorage.getItem("mc_role") || "customer",
  view: "dashboard",
  executors: [
    { name: "ТехноМеталл", city: "Москва", works: ["токарка", "фрезеровка"], rating: 4.9, reviews: 42, phone: "+7 900 111-22-33", x: 28, y: 38 },
    { name: "Северный Цех", city: "Санкт-Петербург", works: ["сварка", "лазер"], rating: 4.6, reviews: 18, phone: "+7 900 222-33-44", x: 62, y: 26 },
    { name: "Кама CNC", city: "Казань", works: ["фрезеровка"], rating: 4.8, reviews: 27, phone: "+7 900 333-44-55", x: 48, y: 58 },
    { name: "УралМетСервис", city: "Екатеринбург", works: ["токарка", "сварка"], rating: 4.3, reviews: 11, phone: "+7 900 444-55-66", x: 72, y: 68 },
    { name: "ЛазерПром", city: "Москва", works: ["лазер"], rating: 4.1, reviews: 9, phone: "+7 900 555-66-77", x: 35, y: 72 },
  ],
  messages: [
    { text: "Добрый день. Можете прислать чертеж в PDF?", me: false },
    { text: "Да, приложу к заказу сегодня.", me: true },
  ],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function setRole(role) {
  state.role = role;
  localStorage.setItem("mc_role", role);
  $$(".seg").forEach((button) => button.classList.toggle("active", button.dataset.role === role));
  $("#welcomeTitle").textContent = role === "customer" ? "Кабинет заказчика" : role === "executor" ? "Кабинет исполнителя" : "Кабинет разработчика";
  updateDashboard();
}

function setView(view) {
  state.view = view;
  $$(".tab").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $$(".view").forEach((section) => section.classList.toggle("active", section.id === view));
}

function updateDashboard() {
  if (state.role === "executor") {
    $("#activeOrders").textContent = "19";
    $("#todayOffers").textContent = "6";
    $("#avgCheck").textContent = "312k";
    $("#nextStep").textContent = "Поставьте статус 'Принимаю заказы' и добавьте портфолио. Так заказчики быстрее выбирают вас.";
  } else if (state.role === "admin") {
    $("#activeOrders").textContent = "82";
    $("#todayOffers").textContent = "147";
    $("#avgCheck").textContent = "276k";
    $("#nextStep").textContent = "Следите за активными заказами без откликов. Это будущая точка монетизации: поднятие заказа и Pro-размещение.";
  } else {
    $("#activeOrders").textContent = "7";
    $("#todayOffers").textContent = "14";
    $("#avgCheck").textContent = "248k";
    $("#nextStep").textContent = "Добавьте фото или чертеж к заказу. Это повышает доверие исполнителей и ускоряет расчет.";
  }
}

function renderBars() {
  const values = [22, 46, 38, 66, 52, 88, 74];
  const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  $("#weekBars").innerHTML = values.map((value, index) => (
    `<div class="bar"><i style="height:${value}%"></i><span>${days[index]}</span></div>`
  )).join("");
}

function updatePreview() {
  $("#previewTitle").textContent = $("#orderTitle").value || "Новый заказ";
  $("#previewDescription").textContent = $("#orderDescription").value || "Заполните поля слева, и карточка заказа соберется автоматически.";
  $("#previewCity").textContent = $("#orderCity").value || "-";
  $("#previewBudget").textContent = $("#orderBudget").value || "-";
  $("#previewDeadline").textContent = $("#orderDeadline").value || "-";
  $("#previewPayment").textContent = $("#orderPayment").value || "-";
}

function orderPayload() {
  return {
    type: "create_order",
    title: $("#orderTitle").value.trim(),
    description: $("#orderDescription").value.trim(),
    budget: $("#orderBudget").value.trim(),
    city: $("#orderCity").value.trim(),
    deadline: $("#orderDeadline").value.trim(),
    payment_terms: $("#orderPayment").value,
  };
}

function publishOrder() {
  const payload = orderPayload();
  if (!payload.title || !payload.description || !payload.budget || !payload.city || !payload.deadline) {
    showToast("Заполните название, описание, бюджет, город и срок.");
    return;
  }

  if (tg?.sendData) {
    tg.sendData(JSON.stringify(payload));
    tg.close();
  } else {
    localStorage.setItem("mc_last_order", JSON.stringify(payload));
    showToast("Демо: заказ сохранен локально. В Telegram он отправится в бота.");
  }
}

function renderExecutors() {
  const city = $("#cityFilter").value;
  const work = $("#workFilter").value;
  const minRating = Number($("#ratingFilter").value);
  $("#ratingValue").textContent = minRating.toFixed(1);

  const filtered = state.executors.filter((executor) => (
    (!city || executor.city === city) &&
    (!work || executor.works.includes(work)) &&
    executor.rating >= minRating
  ));

  $("#executorCards").innerHTML = filtered.map((executor) => `
    <article class="executor-card">
      <div class="avatar">${executor.name.slice(0, 2).toUpperCase()}</div>
      <div>
        <h2>${executor.name}</h2>
        <p>${executor.city} · ${executor.rating}/5 · ${executor.reviews} отзывов</p>
      </div>
      <div class="tags">${executor.works.map((item) => `<span class="tag">${item}</span>`).join("")}</div>
      <button class="ghost" type="button" data-phone="${executor.phone}">Позвонить через Telegram</button>
    </article>
  `).join("") || `<article class="panel"><h2>Ничего не найдено</h2><p>Попробуйте снизить рейтинг или убрать фильтр по типу работ.</p></article>`;
}

function renderMap() {
  $("#mapCanvas").innerHTML = state.executors.map((executor, index) => (
    `<button class="pin" style="left:${executor.x}%;top:${executor.y}%" data-index="${index}" type="button" aria-label="${executor.name}"></button>`
  )).join("");
}

function selectMapExecutor(index) {
  const executor = state.executors[index];
  $("#mapTitle").textContent = executor.name;
  $("#mapText").textContent = `${executor.city}. ${executor.works.join(", ")}. Рейтинг ${executor.rating}/5, отзывов: ${executor.reviews}.`;
}

function renderMessages() {
  $("#messages").innerHTML = state.messages.map((message) => (
    `<div class="bubble ${message.me ? "me" : ""}">${message.text}</div>`
  )).join("");
}

function showToast(message) {
  if (tg?.showPopup) {
    tg.showPopup({ message });
  } else {
    alert(message);
  }
}

function useTemplate() {
  $("#orderTitle").value = "Токарная обработка втулок 40Х, 120 шт.";
  $("#orderCity").value = "Москва";
  $("#orderBudget").value = "до 180 000 руб.";
  $("#orderDeadline").value = "14 рабочих дней";
  $("#orderPayment").value = "Безнал, 50/50";
  $("#orderDescription").value = "Нужно изготовить партию втулок по чертежу. Материал 40Х. Важны аккуратная упаковка и доставка до ТК.";
  updatePreview();
}

function initEvents() {
  $$(".seg").forEach((button) => button.addEventListener("click", () => setRole(button.dataset.role)));
  $$(".tab").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$("[data-go]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.go)));
  ["orderTitle", "orderCity", "orderBudget", "orderDeadline", "orderPayment", "orderDescription"].forEach((id) => {
    $(`#${id}`).addEventListener("input", updatePreview);
  });
  $("#publishOrderBtn").addEventListener("click", publishOrder);
  $("#useTemplateBtn").addEventListener("click", useTemplate);
  $("#cityFilter").addEventListener("change", renderExecutors);
  $("#workFilter").addEventListener("change", renderExecutors);
  $("#ratingFilter").addEventListener("input", renderExecutors);
  $("#mapCanvas").addEventListener("click", (event) => {
    if (event.target.matches(".pin")) selectMapExecutor(Number(event.target.dataset.index));
  });
  $("#chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#chatInput");
    if (!input.value.trim()) return;
    state.messages.push({ text: input.value.trim(), me: true });
    input.value = "";
    renderMessages();
  });
  $$(".quick button").forEach((button) => button.addEventListener("click", () => {
    $("#chatInput").value = button.textContent;
    $("#chatInput").focus();
  }));
  $("#supportBtn").addEventListener("click", () => {
    if (tg?.openTelegramLink) {
      tg.openTelegramLink("https://t.me/valentinn_nikonov");
    } else {
      showToast("Поддержка откроется внутри Telegram.");
    }
  });
  $("#tutorialBtn").addEventListener("click", () => showToast("Шаг 1: заполните профиль. Шаг 2: создайте заказ. Шаг 3: сравните предложения."));
  $("#callBtn").addEventListener("click", () => showToast("Звонок будет открываться через Telegram-профиль участника."));
  $("#routeBtn").addEventListener("click", () => showToast("Маршрут подключим после выбора карт: Яндекс или Google."));
}

renderBars();
renderExecutors();
renderMap();
renderMessages();
updatePreview();
initEvents();
setRole(state.role);

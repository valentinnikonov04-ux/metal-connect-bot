window.addEventListener("error", function (event) {
  var errorBox = document.createElement("div");
  errorBox.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;padding:12px;border-radius:8px;background:#fff3f0;color:#8a1f11;border:1px solid #e0a297;font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
  errorBox.textContent = "Ошибка Mini App: " + (event.message || "неизвестная ошибка");
  document.body.appendChild(errorBox);
});

var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
}

var state = {
  role: safeGet("mc_role", "customer"),
  view: "dashboardView",
  orderTab: "active",
  material: "Сталь",
  executors: [
    { name: "ТехноМеталл", city: "Москва", works: ["токарка", "фрезеровка"], rating: 4.9, reviews: 42, note: "Брал у них фрезеровку, отвечают быстро" },
    { name: "Северный Цех", city: "Санкт-Петербург", works: ["сварка", "лазер"], rating: 4.6, reviews: 18, note: "Сильны в сварных рамах" },
    { name: "Кама CNC", city: "Казань", works: ["фрезеровка"], rating: 4.8, reviews: 27, note: "Хорошая чистовая обработка" },
    { name: "УралМетСервис", city: "Екатеринбург", works: ["токарка", "сварка"], rating: 4.3, reviews: 11, note: "Можно уточнить сроки" },
    { name: "ЛазерПром", city: "Москва", works: ["лазер"], rating: 4.1, reviews: 9, note: "Резка листа и гибка" }
  ],
  customerOrders: [
    { id: 12, title: "Втулки 40Х, 120 шт.", status: "active", date: "26.05.2026", offers: 3, budget: "80 000 - 160 000 ₽", city: "Москва" },
    { id: 11, title: "Фрезеровка плит 09Г2С", status: "work", date: "24.05.2026", offers: 5, budget: "до 250 000 ₽", city: "Казань" },
    { id: 8, title: "Лазерная резка корпусов", status: "done", date: "15.05.2026", offers: 7, budget: "120 000 ₽", city: "Москва" }
  ],
  executorOrders: [
    { id: 44, title: "Оси 20Х13, 60 шт.", status: "new", date: "26.05.2026", budget: "140 000 ₽", city: "Москва", qty: "60 шт.", material: "Сталь" },
    { id: 41, title: "Алюминиевые кронштейны", status: "offer", date: "25.05.2026", budget: "договорной", city: "Казань", qty: "30 шт.", material: "Алюминий" },
    { id: 33, title: "Сварная рама под оборудование", status: "work", date: "21.05.2026", budget: "210 000 ₽", city: "Санкт-Петербург", qty: "2 шт.", material: "Сталь" }
  ],
  offers: [
    { company: "ТехноМеталл", rating: "4.9 ★", price: "145 000 ₽", deadline: "9 дней", comment: "Готовы взять в работу после согласования чертежа." },
    { company: "Кама CNC", rating: "4.8 ★", price: "158 000 ₽", deadline: "7 дней", comment: "Можем ускорить, если материал ваш." }
  ],
  messages: [
    { text: "Добрый день. Когда сможете приступить?", me: false },
    { text: "Сегодня уточню по материалу и вернусь с точным сроком.", me: true }
  ]
};

var roleTabs = {
  customer: [
    ["dashboardView", "Дашборд"],
    ["builderView", "Новый заказ"],
    ["ordersView", "Мои заказы"],
    ["offersView", "Предложения"],
    ["marketView", "Исполнители"],
    ["chatView", "Чат"],
    ["profileView", "Профиль"]
  ],
  executor: [
    ["dashboardView", "Дашборд"],
    ["marketView", "Поиск заказов"],
    ["ordersView", "Мои заказы"],
    ["offersView", "Отклики"],
    ["chatView", "Чат"],
    ["profileView", "Профиль"]
  ],
  admin: [
    ["dashboardView", "Дашборд"],
    ["ordersView", "Заказы"],
    ["marketView", "Участники"],
    ["offersView", "События"],
    ["profileView", "Настройки"]
  ]
};

var $ = function (selector) { return document.querySelector(selector); };
var $$ = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };

function setRole(role) {
  state.role = role;
  safeSet("mc_role", role);
  $$(".seg").forEach(function (button) {
    button.classList.toggle("active", button.dataset.role === role);
  });
  renderTabs();
  setView("dashboardView");
  renderAll();
}

function renderTabs() {
  var tabs = roleTabs[state.role] || roleTabs.customer;
  $("#tabs").innerHTML = tabs.map(function (item) {
    return '<button class="tab" data-view="' + item[0] + '" type="button">' + item[1] + "</button>";
  }).join("");
  $$("#tabs .tab").forEach(function (button) {
    button.addEventListener("click", function () { setView(button.dataset.view); });
  });
}

function setView(view) {
  state.view = view;
  $$(".tab").forEach(function (button) {
    button.classList.toggle("active", button.dataset.view === view);
  });
  $$(".view").forEach(function (section) {
    section.classList.toggle("active", section.id === view);
  });
}

function renderDashboard() {
  var isExecutor = state.role === "executor";
  var isAdmin = state.role === "admin";
  $("#welcomeTitle").textContent = isExecutor ? "Кабинет исполнителя" : isAdmin ? "Кабинет разработчика" : "Кабинет заказчика";
  $("#roleEyebrow").textContent = isExecutor ? "Исполнитель" : isAdmin ? "Админ" : "Заказчик";
  $("#heroTitle").textContent = isExecutor ? "Добрый день, СтанкоМастер! 🔧" : isAdmin ? "Добрый день, Валентин!" : "Добрый день, Александр! 👋";
  $("#heroText").textContent = isExecutor
    ? "Следите за новыми заказами, отправляйте предложения и держите портфолио под рукой."
    : isAdmin
      ? "Контролируйте активность, качество профилей и будущие точки монетизации."
      : "Создавайте заказы, сравнивайте предложения и выбирайте исполнителей напрямую.";

  $("#heroActions").innerHTML = isExecutor
    ? '<button class="primary" data-go="marketView" type="button">🔍 Поиск заказов</button><button class="ghost" data-go="ordersView" type="button">📋 Мои заказы</button>'
    : '<button class="primary" data-go="builderView" type="button">➕ Новый заказ</button><button class="ghost" data-go="marketView" type="button">🔍 Найти исполнителя</button>';

  var metrics = isExecutor ? [
    ["Доступно новых заказов", "12", "по вашим специализациям"],
    ["Мои активные заказы", "3", "в работе"],
    ["Выполнено за месяц", "8", "закрытых заказов"],
    ["Рейтинг", "4.8 ★", "уровень: Профи"]
  ] : isAdmin ? [
    ["Активных заказов", "82", "на площадке"],
    ["Предложений сегодня", "147", "живая воронка"],
    ["Новых компаний", "19", "за неделю"],
    ["Потенциал комиссии", "408k", "демо-оценка"]
  ] : [
    ["Активных заказов", "3", "1 ждет исполнителя"],
    ["Новых предложений", "2", "за сегодня"],
    ["В избранном", "5", "проверенных исполнителей"],
    ["Средний чек", "180k", "по вашим заказам"]
  ];

  $("#dashboardMetrics").innerHTML = metrics.map(function (item) {
    return '<article class="metric"><span>' + item[0] + '</span><strong>' + item[1] + '</strong><small>' + item[2] + '</small></article>';
  }).join("");

  var feed = isExecutor ? [
    ["⚡", "Новый заказ по фрезеровке в Москве, бюджет до 140 000 ₽."],
    ["🎉", "Ваше предложение по заказу #33 принято."],
    ["📸", "Добавьте 2-3 фото работ, профиль станет заметнее."]
  ] : [
    ["🔥", "Есть первый отклик по заказу #12."],
    ["⭐", "ТехноМеталл добавлен в избранное."],
    ["💬", "Исполнитель задал вопрос по материалу."]
  ];
  $("#todayFeed").innerHTML = feed.map(function (item) {
    return '<div class="event"><i>' + item[0] + '</i><p>' + item[1] + '</p></div>';
  }).join("");
  $("#activityTitle").textContent = isExecutor ? "Загрузка по неделе" : "Активность за неделю";
  $("#activityBadge").textContent = isExecutor ? "календарь скоро" : "живой спрос";
  bindGoButtons();
}

function renderBars() {
  var values = state.role === "executor" ? [40, 70, 82, 65, 88, 34, 20] : [22, 46, 38, 66, 52, 88, 74];
  var days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  $("#weekBars").innerHTML = values.map(function (value, index) {
    return '<div class="bar"><i style="height:' + value + '%"></i><span>' + days[index] + '</span></div>';
  }).join("");
}

function renderSteps() {
  var filled = [
    $("#orderTitle").value.trim(),
    $("#orderDescription").value.trim(),
    state.material,
    $("#orderQty").value,
    $("#orderDeadline").value || $("#budgetFrom").value || $("#budgetTo").value
  ];
  var labels = ["Название", "Описание", "Материал", "Кол-во", "Срок/бюджет"];
  $("#orderSteps").innerHTML = labels.map(function (label, index) {
    return '<div class="step ' + (filled[index] ? "active" : "") + '">' + (index + 1) + ". " + label + "</div>";
  }).join("");
}

function updatePreview() {
  var qty = $("#orderQty").value + " шт.";
  var deadline = $("#orderDeadline").value || "-";
  var budget = $("#negotiableBudget").checked ? "Договорной" : buildBudget();
  $("#qtyValue").textContent = qty;
  $("#previewTitle").textContent = $("#orderTitle").value || "Новый заказ";
  $("#previewDescription").textContent = $("#orderDescription").value || "Заполните поля, и карточка заказа соберется автоматически.";
  $("#previewMaterial").textContent = state.material;
  $("#previewQty").textContent = qty;
  $("#previewCity").textContent = $("#orderCity").value || "-";
  $("#previewDeadline").textContent = deadline;
  $("#previewBudget").textContent = budget || "-";
  var score = orderQualityScore();
  $("#qualityScore").textContent = score + "%";
  $("#qualityBar").style.width = score + "%";
  renderSteps();
}

function buildBudget() {
  var from = $("#budgetFrom").value;
  var to = $("#budgetTo").value;
  if (from && to) return from + " - " + to + " ₽";
  if (from) return "от " + from + " ₽";
  if (to) return "до " + to + " ₽";
  return "";
}

function orderQualityScore() {
  var score = 30;
  if ($("#orderTitle").value.trim()) score += 12;
  if ($("#orderDescription").value.trim().length > 20) score += 18;
  if ($("#orderCity").value.trim()) score += 10;
  if ($("#orderDeadline").value) score += 10;
  if ($("#negotiableBudget").checked || $("#budgetFrom").value || $("#budgetTo").value) score += 12;
  if ($("#orderFiles").files && $("#orderFiles").files.length) score += 8;
  return Math.min(score, 100);
}

function orderPayload() {
  return {
    type: "create_order",
    title: $("#orderTitle").value.trim(),
    description: ($("#orderDescription").value.trim() + "\nМатериал: " + state.material + "\nКоличество: " + $("#orderQty").value + " шт.").trim(),
    budget: $("#negotiableBudget").checked ? "Договорной" : buildBudget(),
    city: $("#orderCity").value.trim(),
    deadline: $("#orderDeadline").value,
    payment_terms: $("#orderPayment").value
  };
}

function publishOrder() {
  var payload = orderPayload();
  if (!payload.title || !payload.description || !payload.budget || !payload.city || !payload.deadline) {
    showToast("Заполните название, описание, город, срок и бюджет.");
    return;
  }
  if (tg && tg.sendData) {
    tg.sendData(JSON.stringify(payload));
    tg.close();
  } else {
    safeSet("mc_last_order", JSON.stringify(payload));
    showToast("Демо: заказ сохранен локально. В Telegram он отправится в бота.");
  }
}

function renderOrders() {
  var isExecutor = state.role === "executor";
  $("#ordersTitle").textContent = isExecutor ? "Мои заказы исполнителя" : "Мои заказы";
  var tabs = isExecutor
    ? [["work", "🟡 В работе"], ["done", "✅ Выполненные"], ["offer", "⏳ Ожидают ответа"]]
    : [["active", "🟢 Активные"], ["work", "🟡 В работе"], ["done", "✅ Выполненные"]];
  $("#orderSubtabs").innerHTML = tabs.map(function (tab) {
    return '<button class="subtab ' + (state.orderTab === tab[0] ? "active" : "") + '" data-tab="' + tab[0] + '" type="button">' + tab[1] + "</button>";
  }).join("");
  $$("#orderSubtabs .subtab").forEach(function (button) {
    button.addEventListener("click", function () {
      state.orderTab = button.dataset.tab;
      renderOrders();
    });
  });

  var rows = isExecutor ? state.executorOrders : state.customerOrders;
  var filtered = rows.filter(function (order) {
    if (state.orderTab === "active") return order.status === "active" || order.status === "new";
    return order.status === state.orderTab;
  });
  $("#ordersList").innerHTML = filtered.map(function (order) {
    var statusClass = order.status === "done" ? "done" : order.status === "work" || order.status === "offer" ? "warn" : "";
    var statusText = statusLabel(order.status);
    var actions = isExecutor
      ? '<button class="primary small" type="button">💰 Сделать предложение</button><button class="ghost" type="button">💬 Написать заказчику</button><button class="ghost" type="button">Перенести срок</button>'
      : '<button class="primary small" data-go="offersView" type="button">Смотреть предложения</button><button class="ghost" data-go="chatView" type="button">💬 Написать</button><button class="ghost" type="button">Завершить</button>';
    return '<article class="order-card"><div class="card-head"><div><h3>#' + order.id + ' ' + order.title + '</h3><p>' + order.city + ' · ' + order.date + ' · ' + order.budget + '</p></div><span class="status ' + statusClass + '">' + statusText + '</span></div><div class="tags"><span class="tag">Предложений: ' + (order.offers || 0) + '</span><span class="tag">' + (order.material || "Металл") + '</span><span class="tag">' + (order.qty || "партия") + '</span></div><div class="card-actions">' + actions + '</div></article>';
  }).join("") || '<article class="panel"><h2>Пока пусто</h2><p>Здесь появятся заказы после первых действий.</p></article>';
  bindGoButtons();
}

function statusLabel(status) {
  var labels = { active: "Ждет исполнителя", new: "Новый", work: "В работе", done: "Выполнен", offer: "Ожидает ответа" };
  return labels[status] || status;
}

function renderMarket() {
  if (state.role === "executor") {
    $("#marketTitle").textContent = "Поиск заказов";
    $("#marketCards").innerHTML = state.executorOrders.map(function (order) {
      return '<article class="entity-card"><div class="card-head"><div><h3>#' + order.id + ' ' + order.title + '</h3><p>' + order.city + ' · ' + order.budget + ' · ' + order.date + '</p></div><span class="badge neutral">' + order.material + '</span></div><div class="tags"><span class="tag">' + order.qty + '</span><span class="tag">срочность: средняя</span><span class="tag">чертеж: PDF</span></div><div class="card-actions"><button class="primary small" type="button">💰 Сделать предложение</button><button class="ghost" data-go="chatView" type="button">💬 Уточнить</button></div></article>';
    }).join("");
    bindGoButtons();
    return;
  }

  $("#marketTitle").textContent = "Поиск исполнителей";
  var city = $("#cityFilter").value;
  var work = $("#workFilter").value;
  var minRating = Number($("#ratingFilter").value);
  $("#ratingValue").textContent = minRating.toFixed(1);
  var filtered = state.executors.filter(function (executor) {
    return (!city || executor.city === city) && (!work || executor.works.indexOf(work) !== -1) && executor.rating >= minRating;
  });
  $("#marketCards").innerHTML = filtered.map(function (executor) {
    return '<article class="entity-card"><div class="card-head"><div class="avatar">' + executor.name.slice(0, 2).toUpperCase() + '</div><div><h3>' + executor.name + '</h3><p>' + executor.city + ' · ' + executor.rating + '/5 · ' + executor.reviews + ' отзывов</p></div></div><div class="tags">' + executor.works.map(function (workName) { return '<span class="tag">' + workName + '</span>'; }).join("") + '</div><p>' + executor.note + '</p><div class="card-actions"><button class="primary small" type="button">➕ В избранное</button><button class="ghost" data-go="chatView" type="button">💬 Написать</button><button class="ghost" data-go="builderView" type="button">Создать заказ для него</button></div></article>';
  }).join("") || '<article class="panel"><h2>Ничего не найдено</h2><p>Попробуйте снизить рейтинг или убрать фильтр по типу работ.</p></article>';
  bindGoButtons();
}

function renderOffers() {
  var isExecutor = state.role === "executor";
  $("#offersTitle").textContent = isExecutor ? "Отклики и уведомления" : "Предложения от исполнителей";
  $("#offersBadge").textContent = isExecutor ? "лента" : state.offers.length + " новых";
  if (isExecutor) {
    $("#offersList").innerHTML = [
      ["🎉", "Ваше предложение по заказу #33 принято.", "Открыть заказ"],
      ["🔥", "Появился срочный заказ на фрезеровку в Москве.", "Посмотреть"],
      ["⭐", "Новый отзыв: 5 звезд от заказчика.", "Портфолио"]
    ].map(function (item) {
      return '<article class="order-card"><div class="event"><i>' + item[0] + '</i><p>' + item[1] + '</p></div><button class="ghost" type="button">' + item[2] + '</button></article>';
    }).join("");
    return;
  }
  $("#offersList").innerHTML = state.offers.map(function (offer) {
    return '<article class="order-card"><div class="card-head"><div><h3>' + offer.company + '</h3><p>' + offer.rating + ' · срок: ' + offer.deadline + '</p></div><strong>' + offer.price + '</strong></div><p>' + offer.comment + '</p><div class="card-actions"><button class="primary small" type="button">✅ Принять</button><button class="ghost" type="button">❌ Отказать</button><button class="ghost" data-go="chatView" type="button">💬 Уточнить</button></div></article>';
  }).join("");
  bindGoButtons();
}

function renderChat() {
  var quick = state.role === "executor"
    ? ["Перенести срок", "Завершить заказ", "Пришлю фото готовности"]
    : ["Когда сделаете?", "Пришлите примеры работ", "Какая нужна предоплата?"];
  $("#quickReplies").innerHTML = quick.map(function (text) {
    return '<button type="button">' + text + '</button>';
  }).join("");
  $("#messages").innerHTML = state.messages.map(function (message) {
    return '<div class="bubble ' + (message.me ? "me" : "") + '">' + message.text + '</div>';
  }).join("");
  $$("#quickReplies button").forEach(function (button) {
    button.addEventListener("click", function () {
      $("#chatInput").value = button.textContent;
      $("#chatInput").focus();
    });
  });
}

function renderProfile() {
  var isExecutor = state.role === "executor";
  $("#profileTitle").textContent = isExecutor ? "Профиль исполнителя" : state.role === "admin" ? "Профиль администратора" : "Профиль заказчика";
  var rows = isExecutor ? [
    ["Компания", "СтанкоМастер"],
    ["Город", "Москва"],
    ["Специализация", "Токарка, фрезеровка, сварка"],
    ["Рейтинг", "4.8 ★"],
    ["Портфолио", "7 фото работ"],
    ["Статус", "Принимаю заказы"]
  ] : [
    ["Компания", "Александр Металл"],
    ["Город", "Москва"],
    ["Телефон", "+7 900 000-00-00"],
    ["История", "12 заказов"],
    ["Избранное", "5 исполнителей"],
    ["Тариф", "Free"]
  ];
  $("#profileCard").innerHTML = rows.map(function (row) {
    return '<div class="profile-line"><span>' + row[0] + '</span><b>' + row[1] + '</b></div>';
  }).join("") + '<button class="primary" type="button">Редактировать профиль</button>';
}

function useTemplate() {
  $("#orderTitle").value = "Токарная обработка втулок 40Х, 120 шт.";
  $("#orderCity").value = "Москва";
  $("#orderDescription").value = "Нужно изготовить партию втулок по чертежу. Материал 40Х. Важны аккуратная упаковка и доставка до ТК.";
  $("#budgetFrom").value = "80000";
  $("#budgetTo").value = "160000";
  $("#orderQty").value = "120";
  state.material = "Сталь";
  $$(".material").forEach(function (button) {
    button.classList.toggle("active", button.dataset.material === state.material);
  });
  updatePreview();
}

function initEvents() {
  $$(".seg").forEach(function (button) {
    button.addEventListener("click", function () { setRole(button.dataset.role); });
  });
  $$(".material").forEach(function (button) {
    button.addEventListener("click", function () {
      state.material = button.dataset.material;
      $$(".material").forEach(function (item) { item.classList.toggle("active", item === button); });
      updatePreview();
    });
  });
  ["orderTitle", "orderCity", "orderDescription", "orderQty", "orderDeadline", "budgetFrom", "budgetTo", "negotiableBudget", "orderPayment", "orderFiles"].forEach(function (id) {
    $("#" + id).addEventListener("input", updatePreview);
    $("#" + id).addEventListener("change", updatePreview);
  });
  $("#publishOrderBtn").addEventListener("click", publishOrder);
  $("#useTemplateBtn").addEventListener("click", useTemplate);
  $("#cityFilter").addEventListener("change", renderMarket);
  $("#workFilter").addEventListener("change", renderMarket);
  $("#ratingFilter").addEventListener("input", renderMarket);
  $("#chatForm").addEventListener("submit", function (event) {
    event.preventDefault();
    var input = $("#chatInput");
    if (!input.value.trim()) return;
    state.messages.push({ text: input.value.trim(), me: true });
    input.value = "";
    renderChat();
  });
  $("#supportBtn").addEventListener("click", function () {
    if (tg && tg.openTelegramLink) {
      tg.openTelegramLink("https://t.me/valentinn_nikonov");
    } else {
      showToast("Поддержка откроется внутри Telegram.");
    }
  });
  $("#attachBtn").addEventListener("click", function () { showToast("Прикрепление файлов в чате подключим вместе с backend API."); });
}

function bindGoButtons() {
  $$("[data-go]").forEach(function (button) {
    button.onclick = function () { setView(button.dataset.go); };
  });
}

function renderAll() {
  renderDashboard();
  renderBars();
  updatePreview();
  renderOrders();
  renderMarket();
  renderOffers();
  renderChat();
  renderProfile();
}

function showToast(message) {
  if (tg && tg.showPopup) {
    tg.showPopup({ message: message });
  } else {
    alert(message);
  }
}

function safeGet(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch (error) {
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    return false;
  }
  return true;
}

renderTabs();
initEvents();
setRole(state.role);

window.addEventListener("error", function (event) {
  var errorBox = document.createElement("div");
  errorBox.className = "error-box";
  errorBox.textContent = "Ошибка Mini App: " + (event.message || "неизвестная ошибка");
  document.body.appendChild(errorBox);
});

var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
}

var $ = function (selector) { return document.querySelector(selector); };
var $$ = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };

var state = {
  role: safeGet("mc_role", "customer"),
  view: "dashboardView",
  orderTab: "active",
  material: "Сталь",
  selectedOrder: null,
  favoriteNotes: {
    "ТехноМеталл": "Брал у них фрезеровку, отвечают быстро",
    "Кама CNC": "Хорошая чистовая обработка, можно срочно",
    "Северный Цех": "Сильны в сварных рамах"
  },
  executors: [
    { name: "ТехноМеталл", city: "Москва", works: ["токарка", "фрезеровка"], rating: 4.9, reviews: 42, note: "Токарка, фрезеровка, контроль ОТК. Быстро отвечают и держат сроки.", favorite: true },
    { name: "Северный Цех", city: "Санкт-Петербург", works: ["сварка", "лазер"], rating: 4.6, reviews: 18, note: "Сварные рамы, лазерная резка, сборка узлов.", favorite: true },
    { name: "Кама CNC", city: "Казань", works: ["фрезеровка"], rating: 4.8, reviews: 27, note: "Чистовая обработка, алюминий и сталь, аккуратная упаковка.", favorite: true },
    { name: "УралМетСервис", city: "Екатеринбург", works: ["токарка", "сварка"], rating: 4.3, reviews: 11, note: "Средние партии, сварка и токарные работы.", favorite: false },
    { name: "ЛазерПром", city: "Москва", works: ["лазер"], rating: 4.1, reviews: 9, note: "Резка листа, гибка, маркировка.", favorite: true },
    { name: "ТитанПро", city: "Москва", works: ["титан", "фрезеровка"], rating: 4.7, reviews: 15, note: "Титановые детали и малые ответственные партии.", favorite: true }
  ],
  customerOrders: [
    { id: 12, title: "Втулки 40Х, 120 шт.", status: "active", date: "26.05.2026", offers: 3, budget: "80 000 - 160 000 ₽", city: "Москва", qty: "120 шт.", material: "Сталь", executor: "не выбран" },
    { id: 11, title: "Фрезеровка плит 09Г2С", status: "work", date: "24.05.2026", offers: 5, budget: "до 250 000 ₽", city: "Казань", qty: "30 шт.", material: "Сталь", executor: "Кама CNC" },
    { id: 8, title: "Лазерная резка корпусов", status: "done", date: "15.05.2026", offers: 7, budget: "120 000 ₽", city: "Москва", qty: "80 шт.", material: "Сталь", executor: "ЛазерПром" }
  ],
  executorOrders: [
    { id: 44, title: "Оси 20Х13, 60 шт.", status: "new", date: "26.05.2026", budget: "140 000 ₽", city: "Москва", customer: "Александр Металл", qty: "60 шт.", material: "Сталь", urgency: "средняя", deadline: "08.06.2026", drawing: "PDF" },
    { id: 41, title: "Алюминиевые кронштейны", status: "offer", date: "25.05.2026", budget: "договорной", city: "Казань", customer: "Кама Деталь", qty: "30 шт.", material: "Алюминий", urgency: "низкая", deadline: "14.06.2026", drawing: "STEP" },
    { id: 33, title: "Сварная рама под оборудование", status: "work", date: "21.05.2026", budget: "210 000 ₽", city: "Санкт-Петербург", customer: "Север Маш", qty: "2 шт.", material: "Сталь", urgency: "высокая", deadline: "02.06.2026", drawing: "фото" },
    { id: 30, title: "Титановые шайбы, малая партия", status: "new", date: "20.05.2026", budget: "95 000 ₽", city: "Москва", customer: "МедТех", qty: "45 шт.", material: "Титан", urgency: "средняя", deadline: "11.06.2026", drawing: "PDF" }
  ],
  offers: [
    { company: "ТехноМеталл", rating: 4.9, price: "145 000 ₽", deadline: "9 дней", comment: "Готовы взять в работу после согласования чертежа. Контроль размеров включен." },
    { company: "Кама CNC", rating: 4.8, price: "158 000 ₽", deadline: "7 дней", comment: "Можем ускорить, если материал ваш. Упаковка до ТК включена." },
    { company: "ТитанПро", rating: 4.7, price: "162 000 ₽", deadline: "10 дней", comment: "Предлагаем финальный контроль партии и фотоотчет по готовности." }
  ],
  messages: [
    { text: "Добрый день. Когда сможете приступить?", me: false },
    { text: "Сегодня уточню по материалу и вернусь с точным сроком.", me: true }
  ],
  portfolio: [
    { title: "Корпуса из алюминия", meta: "Фрезеровка · 24 детали", tone: "blue" },
    { title: "Оси 20Х13", meta: "Токарка · партия 80 шт.", tone: "green" },
    { title: "Сварная рама", meta: "Сварка · порошковая окраска", tone: "amber" },
    { title: "Втулки 40Х", meta: "Токарка · контроль размеров", tone: "steel" }
  ],
  reviews: [
    { author: "Александр Металл", stars: "5.0", text: "Срок выдержали, размеры в допуске, по упаковке без вопросов." },
    { author: "Кама Деталь", stars: "4.8", text: "Хорошая коммуникация и быстрый расчет после уточнения чертежа." }
  ]
};

var roleTabs = {
  customer: [
    ["dashboardView", "Дашборд"],
    ["builderView", "Новый заказ"],
    ["ordersView", "Мои заказы"],
    ["offersView", "Предложения"],
    ["marketView", "Исполнители"],
    ["favoritesView", "Избранное"],
    ["chatView", "Чат"],
    ["profileView", "Профиль"]
  ],
  executor: [
    ["dashboardView", "Дашборд"],
    ["marketView", "Поиск заказов"],
    ["ordersView", "Мои заказы"],
    ["calendarView", "Календарь"],
    ["offersView", "Уведомления"],
    ["portfolioView", "Портфолио"],
    ["statsView", "Статистика"],
    ["chatView", "Чат"],
    ["profileView", "Профиль"]
  ]
};

function h(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setRole(role) {
  state.role = roleTabs[role] ? role : "customer";
  state.orderTab = state.role === "executor" ? "work" : "active";
  safeSet("mc_role", state.role);
  $$(".seg").forEach(function (button) {
    button.classList.toggle("active", button.dataset.role === state.role);
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
  if (view === "marketView") renderMarket();
  if (view === "favoritesView") renderFavorites();
  if (view === "calendarView") renderCalendar();
  if (view === "portfolioView") renderPortfolio();
  if (view === "statsView") renderStats();
}

function renderDashboard() {
  var isExecutor = state.role === "executor";
  $("#welcomeTitle").textContent = isExecutor ? "Кабинет исполнителя" : "Кабинет заказчика";
  $("#roleEyebrow").textContent = isExecutor ? "Производство" : "Заказчик";
  $("#heroTitle").textContent = isExecutor ? "Добрый день, СтанкоМастер! 🔧" : "Добрый день, Александр! 👋";
  $("#heroText").textContent = isExecutor
    ? "Новые заказы, предложения, календарь загрузки и портфолио в одном рабочем экране."
    : "Создавайте заказы, сравнивайте предложения и держите проверенных исполнителей под рукой.";

  $("#heroActions").innerHTML = isExecutor
    ? '<button class="primary" data-go="marketView" type="button">🔍 Поиск заказов</button><button class="ghost" data-go="ordersView" type="button">📋 Мои заказы</button>'
    : '<button class="primary" data-go="builderView" type="button">➕ Новый заказ</button><button class="ghost" data-go="marketView" type="button">🔍 Найти исполнителя</button>';

  var metrics = isExecutor ? [
    ["Доступно новых заказов", "12", "по вашим специализациям"],
    ["Мои активные заказы", "3", "в работе"],
    ["Выполнено за месяц", "8", "закрытых заказов"],
    ["Рейтинг", "4.8 ★", "уровень: Профи"]
  ] : [
    ["Активных заказов", "3", "1 ждет исполнителя"],
    ["Новых предложений", "2", "за сегодня"],
    ["Исполнителей в избранном", countFavorites(), "проверенных компаний"],
    ["Средний чек", "180k", "по вашим заказам"]
  ];

  $("#dashboardMetrics").innerHTML = metrics.map(function (item) {
    return '<article class="metric"><span>' + h(item[0]) + '</span><strong>' + h(item[1]) + '</strong><small>' + h(item[2]) + '</small></article>';
  }).join("");

  var feed = isExecutor ? [
    ["⚡", "Новый заказ по фрезеровке в Москве, бюджет до 140 000 ₽."],
    ["🎉", "Ваше предложение по заказу #33 принято."],
    ["📅", "На этой неделе свободны четверг и пятница."]
  ] : [
    ["🔥", "Есть первый отклик по заказу #12."],
    ["⭐", "ТехноМеталл добавлен в избранное."],
    ["💬", "Исполнитель задал вопрос по материалу."]
  ];
  $("#todayFeed").innerHTML = feed.map(function (item) {
    return '<div class="event"><i>' + item[0] + '</i><p>' + h(item[1]) + '</p></div>';
  }).join("");
  $("#activityTitle").textContent = isExecutor ? "Загрузка по неделе" : "Активность за неделю";
  $("#activityBadge").textContent = isExecutor ? "календарь" : "живой спрос";
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
    $("#orderDeadline").value || $("#budgetFrom").value || $("#budgetTo").value || $("#negotiableBudget").checked
  ];
  var labels = ["Название", "Описание", "Материал", "Кол-во", "Срок/бюджет"];
  $("#orderSteps").innerHTML = labels.map(function (label, index) {
    return '<div class="step ' + (filled[index] ? "active" : "") + '"><b>' + (index + 1) + '</b><span>' + label + '</span></div>';
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
  if (from && to) return formatMoney(from) + " - " + formatMoney(to) + " ₽";
  if (from) return "от " + formatMoney(from) + " ₽";
  if (to) return "до " + formatMoney(to) + " ₽";
  return "";
}

function formatMoney(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function orderQualityScore() {
  var score = 30;
  if ($("#orderTitle").value.trim()) score += 12;
  if ($("#orderDescription").value.trim().length > 20) score += 18;
  if ($("#orderCity").value.trim()) score += 10;
  if ($("#orderDeadline").value) score += 10;
  if ($("#negotiableBudget").checked || $("#budgetFrom").value || $("#budgetTo").value) score += 12;
  if ($("#orderFiles").files && $("#orderFiles").files.length) score += Math.min($("#orderFiles").files.length, 5) * 2;
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
  if (!payload.title || !$("#orderDescription").value.trim() || !payload.budget || !payload.city || !payload.deadline) {
    showToast("Заполните название, описание, город, срок и бюджет.");
    return;
  }
  if ($("#orderFiles").files && $("#orderFiles").files.length > 5) {
    showToast("Можно приложить до 5 файлов.");
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
      ? '<button class="primary small" data-action="open-offer" data-order="' + order.id + '" type="button">💰 Сделать предложение</button><button class="ghost" data-go="chatView" type="button">💬 Написать заказчику</button><button class="ghost" data-action="postpone" type="button">Перенести срок</button>'
      : '<button class="primary small" data-go="offersView" type="button">Смотреть предложения</button><button class="ghost" data-go="chatView" type="button">💬 Написать</button><button class="ghost" data-action="finish-order" type="button">Завершить</button>';
    return '<article class="order-card">' +
      '<div class="card-head"><div><h3>#' + order.id + ' ' + h(order.title) + '</h3><p>' + h(order.city) + ' · ' + h(order.date) + ' · ' + h(order.budget) + '</p></div><span class="status ' + statusClass + '">' + statusText + '</span></div>' +
      '<div class="tags"><span class="tag">' + h(order.material || "Металл") + '</span><span class="tag">' + h(order.qty || "партия") + '</span><span class="tag">Предложений: ' + h(order.offers || 0) + '</span><span class="tag">Исполнитель: ' + h(order.executor || order.customer || "не выбран") + '</span></div>' +
      '<div class="card-actions">' + actions + '</div></article>';
  }).join("") || '<article class="panel empty"><h2>Пока пусто</h2><p>Здесь появятся заказы после первых действий.</p></article>';
}

function statusLabel(status) {
  var labels = { active: "Ждет исполнителя", new: "Новый", work: "В работе", done: "Выполнен", offer: "Ожидает ответа" };
  return labels[status] || status;
}

function renderMarketFilters() {
  var city = $("#cityFilter").value;
  var work = $("#workFilter").value;
  var isExecutor = state.role === "executor";
  var workOptions = isExecutor
    ? ["Все материалы", "Сталь", "Алюминий", "Титан", "Пластик"]
    : ["Все работы", "токарка", "фрезеровка", "сварка", "лазер", "титан"];
  $("#workFilter").innerHTML = workOptions.map(function (option, index) {
    var value = index === 0 ? "" : option;
    return '<option value="' + h(value) + '">' + h(option.charAt(0).toUpperCase() + option.slice(1)) + '</option>';
  }).join("");
  $("#cityFilter").value = city || "";
  $("#workFilter").value = work || "";
  $(".range").firstChild.textContent = isExecutor ? "Бюджет/приоритет от " : "Рейтинг от ";
}

function renderMarket() {
  var isExecutor = state.role === "executor";
  renderMarketFilters();
  $("#marketTitle").textContent = isExecutor ? "Поиск заказов" : "Поиск исполнителей";
  var city = $("#cityFilter").value;
  var work = $("#workFilter").value;
  var minRating = Number($("#ratingFilter").value);
  $("#ratingValue").textContent = isExecutor ? minRating.toFixed(1) : minRating.toFixed(1);

  if (isExecutor) {
    var orders = state.executorOrders.filter(function (order) {
      return (!city || order.city === city) && (!work || order.material === work);
    });
    $("#marketCards").innerHTML = orders.map(function (order) {
      return '<article class="entity-card order-search-card"><div class="drawing-preview"><span>' + h(order.drawing) + '</span></div>' +
        '<div class="card-head"><div><h3>#' + order.id + ' ' + h(order.title) + '</h3><p>' + h(order.customer) + ' · ' + h(order.city) + ' · срок: ' + h(order.deadline) + '</p></div><span class="badge neutral">' + h(order.material) + '</span></div>' +
        '<div class="tags"><span class="tag">' + h(order.qty) + '</span><span class="tag">срочность: ' + h(order.urgency) + '</span><span class="tag">' + h(order.budget) + '</span></div>' +
        '<div class="card-actions"><button class="primary small" data-action="open-offer" data-order="' + order.id + '" type="button">💰 Сделать предложение</button><button class="ghost" data-go="chatView" type="button">💬 Уточнить</button></div></article>';
    }).join("") || emptyPanel("Подходящих заказов нет", "Попробуйте убрать город или материал.");
    return;
  }

  var filtered = state.executors.filter(function (executor) {
    return (!city || executor.city === city) && (!work || executor.works.indexOf(work) !== -1) && executor.rating >= minRating;
  });
  $("#marketCards").innerHTML = filtered.map(executorCard).join("") || emptyPanel("Ничего не найдено", "Попробуйте снизить рейтинг или убрать фильтр по типу работ.");
}

function executorCard(executor) {
  return '<article class="entity-card"><div class="card-head"><div class="avatar">' + h(executor.name.slice(0, 2).toUpperCase()) + '</div><div><h3>' + h(executor.name) + '</h3><p>' + h(executor.city) + ' · ' + stars(executor.rating) + ' · ' + h(executor.reviews) + ' отзывов</p></div></div>' +
    '<div class="tags">' + executor.works.map(function (workName) { return '<span class="tag">' + h(workName) + '</span>'; }).join("") + '</div>' +
    '<p>' + h(executor.note) + '</p>' +
    '<div class="card-actions"><button class="primary small" data-action="favorite" data-company="' + h(executor.name) + '" type="button">' + (executor.favorite ? "✓ В избранном" : "➕ В избранное") + '</button><button class="ghost" data-go="chatView" type="button">💬 Написать</button><button class="ghost" data-action="order-for" data-company="' + h(executor.name) + '" type="button">Создать заказ для него</button></div></article>';
}

function renderFavorites() {
  var favorites = state.executors.filter(function (executor) { return executor.favorite; });
  $("#favoritesCount").textContent = favorites.length + " сохранено";
  $("#favoritesList").innerHTML = favorites.map(function (executor) {
    var note = state.favoriteNotes[executor.name] || "";
    return '<article class="order-card favorite-card"><div class="card-head"><div><h3>' + h(executor.name) + '</h3><p>' + h(executor.city) + ' · ' + stars(executor.rating) + ' · ' + executor.works.join(", ") + '</p></div><button class="ghost" data-action="remove-favorite" data-company="' + h(executor.name) + '" type="button">Убрать</button></div>' +
      '<label>Личная заметка<textarea rows="2" data-action="favorite-note" data-company="' + h(executor.name) + '">' + h(note) + '</textarea></label>' +
      '<div class="card-actions"><button class="primary small" data-action="order-for" data-company="' + h(executor.name) + '" type="button">Создать заказ для этого исполнителя</button><button class="ghost" data-go="chatView" type="button">💬 Написать</button></div></article>';
  }).join("") || emptyPanel("Избранное пустое", "Добавьте исполнителя из поиска.");
}

function renderOffers() {
  var isExecutor = state.role === "executor";
  $("#offersTitle").textContent = isExecutor ? "Отклики и уведомления" : "Предложения от исполнителей";
  $("#offersBadge").textContent = isExecutor ? "3 непрочитано" : state.offers.length + " новых";
  if (isExecutor) {
    $("#offersList").innerHTML = [
      ["🎉", "Ваше предложение по заказу #33 принято.", "Открыть заказ"],
      ["🔥", "Появился срочный заказ на фрезеровку в Москве.", "Посмотреть"],
      ["⭐", "Новый отзыв: 5 звезд от заказчика.", "Портфолио"]
    ].map(function (item) {
      return '<article class="order-card notice-card"><div class="event"><i>' + item[0] + '</i><p>' + h(item[1]) + '</p></div><button class="ghost" type="button">' + h(item[2]) + '</button></article>';
    }).join("");
    return;
  }
  $("#offersList").innerHTML = state.offers.map(function (offer) {
    return '<article class="order-card"><div class="card-head"><div><h3>' + h(offer.company) + '</h3><p>' + stars(offer.rating) + ' · срок: ' + h(offer.deadline) + '</p></div><strong>' + h(offer.price) + '</strong></div><p>' + h(offer.comment) + '</p><div class="card-actions"><button class="primary small" data-action="accept-offer" type="button">✅ Принять</button><button class="ghost" data-action="decline-offer" type="button">❌ Отказать</button><button class="ghost" data-go="chatView" type="button">💬 Уточнить</button></div></article>';
  }).join("");
}

function renderChat() {
  var quick = state.role === "executor"
    ? ["Перенести срок", "Завершить заказ", "Пришлю фото готовности"]
    : ["Когда сделаете?", "Пришлите примеры работ", "Какая нужна предоплата?"];
  $("#quickReplies").innerHTML = quick.map(function (text) {
    return '<button type="button">' + h(text) + '</button>';
  }).join("");
  $("#messages").innerHTML = state.messages.map(function (message) {
    return '<div class="bubble ' + (message.me ? "me" : "") + '">' + h(message.text) + '</div>';
  }).join("");
  $$("#quickReplies button").forEach(function (button) {
    button.addEventListener("click", function () {
      $("#chatInput").value = button.textContent;
      $("#chatInput").focus();
    });
  });
}

function renderCalendar() {
  var busy = { 3: "work", 4: "work", 8: "offer", 9: "offer", 14: "work", 15: "work", 16: "work", 22: "done", 28: "work" };
  var labels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  var cells = labels.map(function (label) { return '<div class="calendar-label">' + label + '</div>'; });
  for (var day = 1; day <= 31; day += 1) {
    var type = busy[day] || "";
    cells.push('<button class="day ' + type + '" type="button"><b>' + day + '</b><span>' + dayLabel(type) + '</span></button>');
  }
  $("#calendarGrid").innerHTML = cells.join("");
}

function dayLabel(type) {
  if (type === "work") return "занят";
  if (type === "offer") return "резерв";
  if (type === "done") return "сдано";
  return "свободно";
}

function renderPortfolio() {
  $("#portfolioGrid").innerHTML = state.portfolio.map(function (item) {
    return '<article class="portfolio-card ' + item.tone + '"><div></div><h3>' + h(item.title) + '</h3><p>' + h(item.meta) + '</p></article>';
  }).join("");
  $("#reviewsList").innerHTML = state.reviews.map(function (review) {
    return '<article class="order-card"><div class="card-head"><h3>' + h(review.author) + '</h3><span class="status done">' + h(review.stars) + ' ★</span></div><p>' + h(review.text) + '</p></article>';
  }).join("");
}

function renderStats() {
  var metrics = [
    ["Заказов выполнено", "48", "за все время"],
    ["Средний чек", "8 500 ₽", "по закрытым заказам"],
    ["Всего заработано", "408 000 ₽", "демо-оценка"],
    ["Конверсия", "31%", "предложения → заказы"]
  ];
  $("#statsMetrics").innerHTML = metrics.map(function (item) {
    return '<article class="metric"><span>' + h(item[0]) + '</span><strong>' + h(item[1]) + '</strong><small>' + h(item[2]) + '</small></article>';
  }).join("");
  $("#statsFunnel").innerHTML = [
    ["Отправлено предложений", 100],
    ["Получены ответы", 62],
    ["Приняты в работу", 31]
  ].map(function (row) {
    return '<div><span>' + h(row[0]) + '</span><i><em style="width:' + row[1] + '%"></em></i><b>' + row[1] + '%</b></div>';
  }).join("");
  $("#financeFeed").innerHTML = [
    ["₽", "Май: 8 заказов, 86 000 ₽ средний чек."],
    ["↗", "Лучше всего конвертируются заказы с чертежом PDF."],
    ["★", "Рейтинг 4.8 держит карточку выше в поиске."]
  ].map(function (item) {
    return '<div class="event"><i>' + item[0] + '</i><p>' + h(item[1]) + '</p></div>';
  }).join("");
}

function renderProfile() {
  var isExecutor = state.role === "executor";
  $("#profileTitle").textContent = isExecutor ? "Профиль исполнителя" : "Профиль заказчика";
  var rows = isExecutor ? [
    ["Публично", "СтанкоМастер · Москва"],
    ["Специализация", "Токарка, фрезеровка, сварка"],
    ["Рейтинг", "4.8 ★"],
    ["График", "Пн-Пт, 09:00-19:00"],
    ["Приватно", "+7 900 000-00-00"],
    ["Тариф", "Pro, до 30 заказов"]
  ] : [
    ["Имя", "Александр"],
    ["Компания", "Александр Металл"],
    ["Город", "Москва"],
    ["Телефон", "+7 900 000-00-00"],
    ["История", "12 заказов · 8 завершено"],
    ["Тариф", "Free"]
  ];
  $("#profileCard").innerHTML = rows.map(function (row) {
    return '<div class="profile-line"><span>' + h(row[0]) + '</span><b>' + h(row[1]) + '</b></div>';
  }).join("") + '<button class="primary" data-action="edit-profile" type="button">Редактировать профиль</button>';
}

function useTemplate() {
  $("#orderTitle").value = "Токарная обработка втулок 40Х, 120 шт.";
  $("#orderCity").value = "Москва";
  $("#orderDescription").value = "Нужно изготовить партию втулок по чертежу. Материал 40Х. Важны аккуратная упаковка, контроль размеров и доставка до ТК.";
  $("#budgetFrom").value = "80000";
  $("#budgetTo").value = "160000";
  $("#orderQty").value = "120";
  state.material = "Сталь";
  $$(".material").forEach(function (button) {
    button.classList.toggle("active", button.dataset.material === state.material);
  });
  updatePreview();
}

function openOffer(orderId) {
  var order = state.executorOrders.find(function (item) { return String(item.id) === String(orderId); }) || state.executorOrders[0];
  state.selectedOrder = order;
  $("#offerModalTitle").textContent = "Предложение по #" + order.id;
  $("#offerPrice").value = "";
  $("#offerDays").value = "";
  $("#offerComment").value = "";
  if ($("#offerModal").showModal) {
    $("#offerModal").showModal();
  } else {
    $("#offerModal").setAttribute("open", "");
  }
}

function submitOffer(event) {
  event.preventDefault();
  if (event.submitter && event.submitter.value === "cancel") {
    closeOfferModal();
    return;
  }
  if (!$("#offerPrice").value || !$("#offerDays").value || !$("#offerComment").value.trim()) {
    showToast("Заполните цену, срок и комментарий.");
    return;
  }
  closeOfferModal();
  showToast("Предложение отправлено заказчику.");
}

function closeOfferModal() {
  if ($("#offerModal").close) {
    $("#offerModal").close();
  } else {
    $("#offerModal").removeAttribute("open");
  }
}

function quickOffer() {
  $("#offerPrice").value = "145000";
  $("#offerDays").value = "9";
  $("#offerComment").value = "Готовы взять в работу после согласования чертежа. Материал ваш, доставка до ТК включена.";
}

function countFavorites() {
  return state.executors.filter(function (executor) { return executor.favorite; }).length;
}

function stars(value) {
  return Number(value).toFixed(1) + " ★";
}

function emptyPanel(title, text) {
  return '<article class="panel empty"><h2>' + h(title) + '</h2><p>' + h(text) + '</p></article>';
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
  $("#offerForm").addEventListener("submit", submitOffer);
  $("#quickOfferBtn").addEventListener("click", quickOffer);
  $("#sharePortfolioBtn").addEventListener("click", function () { showToast("Ссылка на портфолио скопирована в демо-режиме."); });
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
  document.addEventListener("click", handleActionClick);
  document.addEventListener("input", handleActionInput);
}

function handleActionClick(event) {
  var button = event.target.closest("[data-go], [data-action]");
  if (!button) return;
  if (button.dataset.go) {
    setView(button.dataset.go);
    return;
  }
  var action = button.dataset.action;
  if (action === "open-offer") openOffer(button.dataset.order);
  if (action === "favorite") toggleFavorite(button.dataset.company, true);
  if (action === "remove-favorite") toggleFavorite(button.dataset.company, false);
  if (action === "order-for") {
    setView("builderView");
    $("#orderDescription").value = "Заказ хочу отправить исполнителю: " + button.dataset.company + ". ";
    updatePreview();
  }
  if (action === "finish-order") showToast("Заказ отмечен как завершенный в демо-режиме.");
  if (action === "postpone") showToast("Запрос переноса срока подготовлен.");
  if (action === "accept-offer") showToast("Предложение принято. Исполнитель получит уведомление.");
  if (action === "decline-offer") showToast("Предложение отклонено.");
  if (action === "edit-profile") showToast("Редактирование профиля подключим к API профиля.");
}

function handleActionInput(event) {
  if (event.target.dataset.action !== "favorite-note") return;
  state.favoriteNotes[event.target.dataset.company] = event.target.value;
}

function toggleFavorite(company, value) {
  state.executors.forEach(function (executor) {
    if (executor.name === company) executor.favorite = value;
  });
  renderDashboard();
  renderMarket();
  renderFavorites();
}

function renderAll() {
  renderDashboard();
  renderBars();
  updatePreview();
  renderOrders();
  renderMarket();
  renderFavorites();
  renderOffers();
  renderChat();
  renderCalendar();
  renderPortfolio();
  renderStats();
  renderProfile();
}

function showToast(message) {
  if (tg && tg.showPopup) {
    tg.showPopup({ message: message });
  } else {
    window.alert(message);
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

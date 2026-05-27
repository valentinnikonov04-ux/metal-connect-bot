window.onerror = function(msg, url, line, col, error) {
  console.log("Ошибка:", msg, "в", url, "строка", line);
  debugLog("Ошибка: " + msg + " в " + url + " строка " + line, "error");
  return false;
};

window.addEventListener("error", function (event) {
  debugLog("Ошибка Mini App: " + (event.message || "неизвестная ошибка"), "error");
  var errorBox = document.createElement("div");
  errorBox.className = "error-box";
  errorBox.textContent = "Ошибка Mini App: " + (event.message || "неизвестная ошибка");
  document.body.appendChild(errorBox);
});

window.addEventListener("unhandledrejection", function (event) {
  var message = event.reason && event.reason.message ? event.reason.message : String(event.reason || "неизвестная ошибка");
  console.log("Ошибка:", message, "в Promise", "строка", 0);
  debugLog("Ошибка Promise: " + message, "error");
});

var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
}

var $ = function (selector) { return document.querySelector(selector); };
var $$ = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };
var params = new URLSearchParams(window.location.search);
var explicitUserId = params.get("user_id");
var debugEnabled = params.get("debug") === "1" || safeGet("mc_debug", "") === "1";
var API_BASE = "";

var state = {
  role: normalizeRole(params.get("role") || safeGet("mc_role", "")),
  user: telegramUser(),
  view: "dashboardView",
  orderTab: "open",
  statsPeriod: "month",
  material: "Сталь",
  selectedOrderId: null,
  pendingCalendarDay: null,
  data: emptyData(),
  apiReady: false
};

debugLog("Загружен, ищу API...");
API_BASE = resolveApiUrl();
console.log("[MiniApp] API URL:", API_BASE || "");
if (API_BASE) debugLog("API URL установлен: " + API_BASE);
else debugLog("API не найден. Передайте ?api=URL", "error");

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
    ["ordersView", "Мои предложения"],
    ["calendarView", "Календарь"],
    ["offersView", "Уведомления"],
    ["portfolioView", "Портфолио"],
    ["statsView", "Статистика"],
    ["chatView", "Чат"],
    ["profileView", "Профиль"]
  ]
};

function emptyData() {
  return {
    dashboard: {},
    week: [0, 0, 0, 0, 0, 0, 0],
    orders: [],
    offers: [],
    executors: [],
    favorites: [],
    messages: [],
    notifications: [],
    calendar: {},
    portfolio: [],
    reviews: [],
    stats: {},
    profile: {}
  };
}

function h(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeRole(role) {
  return role === "executor" || role === "customer" ? role : "";
}

function telegramUser() {
  var fallback = { id: explicitUserId, first_name: "Пользователь", username: "" };
  if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) return tg.initDataUnsafe.user;
  return fallback;
}

function greetingName() {
  return state.user.first_name || state.user.username || "Пользователь";
}

function resolveApiUrl() {
  var raw = params.get("api") || window.DEFAULT_API_URL || "";
  var normalized = normalizeApiUrl(raw);
  if (normalized) safeSet("mc_api_url", normalized);
  return normalized;
}

function normalizeApiUrl(value) {
  var url = String(value || "").trim().replace(/\/$/, "");
  if (url.slice(-4) === "/api") url = url.slice(0, -4);
  return url;
}

function setApiUrl(value) {
  API_BASE = normalizeApiUrl(value);
  if (API_BASE) {
    safeSet("mc_api_url", API_BASE);
    debugLog("API URL установлен: " + API_BASE);
    console.log("[MiniApp] API URL:", API_BASE);
    updateApiTools();
    loadData();
    return true;
  }
  debugLog("API не найден. Передайте ?api=URL", "error");
  updateApiTools();
  return false;
}

function ensureApiConfigured() {
  updateApiTools();
  if (API_BASE) return true;
  debugLog("API не найден. Передайте ?api=URL", "error");
  return false;
}

function apiHeaders() {
  var headers = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" };
  if (tg && tg.initData) headers["X-Telegram-Init-Data"] = tg.initData;
  return headers;
}

function apiRequestLog(method, url, body) {
  debugLog("[API] REQUEST: " + method + " " + url + (body ? " " + JSON.stringify(body) : ""));
}

function apiResponseLog(response) {
  debugLog("[API] RESPONSE: " + response.status, response.ok ? "info" : "error");
}

async function apiGet(path) {
  if (!API_BASE) throw new Error("API не настроен");
  var url = API_BASE + withUserId(path);
  apiRequestLog("GET", url);
  var response = await fetch(url, { headers: apiHeaders() });
  apiResponseLog(response);
  if (!response.ok) throw new Error(await apiError(response));
  return response.json();
}

async function apiPost(path, body) {
  if (!API_BASE) throw new Error("API не настроен");
  body = withUserBody(body);
  var url = API_BASE + path;
  apiRequestLog("POST", url, body);
  var response = await fetch(url, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(body || {})
  });
  apiResponseLog(response);
  if (!response.ok) throw new Error(await apiError(response));
  return response.json();
}

async function apiDelete(path) {
  if (!API_BASE) throw new Error("API не настроен");
  var url = API_BASE + withUserId(path);
  apiRequestLog("DELETE", url);
  var response = await fetch(url, {
    method: "DELETE",
    headers: apiHeaders()
  });
  apiResponseLog(response);
  if (!response.ok) throw new Error(await apiError(response));
  return response.json();
}

async function apiError(response) {
  var text = "";
  try {
    var data = await response.json();
    text = data.error || JSON.stringify(data);
  } catch (error) {
    text = await response.text();
  }
  return "API " + response.status + (text ? ": " + text : "");
}

function withUserId(path) {
  var userId = state.user.id || explicitUserId || "";
  if (path.indexOf("user_id=") !== -1) return path;
  if (!userId) return path;
  return path + (path.indexOf("?") === -1 ? "?" : "&") + "user_id=" + encodeURIComponent(userId);
}

function withUserBody(body) {
  var payload = body || {};
  if (!payload.user_id) payload.user_id = state.user.id || explicitUserId || "";
  return payload;
}

async function loadData() {
  if (!ensureApiConfigured()) {
    renderSkeleton();
    renderAll();
    return;
  }
  if (!state.role) {
    renderRoleLocked();
    return;
  }
  safeSet("mc_role", state.role);
  renderSkeleton();
  try {
    var me = await apiGet("/api/me");
    state.role = normalizeRole((me && me.role) || state.role);
    var data = await loadRoleData(state.role, me);
    state.apiReady = true;
    state.role = normalizeRole(data.role) || state.role;
    state.data = normalizeData(data);
  } catch (error) {
    debugLog("LOAD ERROR " + error.message);
    showToast("API ошибка: " + error.message);
    state.apiReady = false;
    state.data = emptyData();
  }
  renderAll();
}

async function loadRoleData(role, me) {
  if (role === "executor") {
    var executorDashboard = await apiGet("/api/dashboard/executor");
    var openOrders = await apiGet("/api/orders/open");
    var executorOffers = await apiGet("/api/offers/executor");
    var executorPortfolio = await apiGet("/api/portfolio");
    var executorCalendar = await apiGet("/api/calendar");
    var executorStats = await apiGet("/api/stats/executor?period=" + encodeURIComponent(state.statsPeriod));
    var executorMessages = await apiGet("/api/chat/messages");
    return {
      role: "executor",
      dashboard: executorDashboard,
      orders: openOrders.orders || [],
      offers: executorOffers.offers || [],
      portfolio: executorPortfolio.portfolio || [],
      calendar: executorCalendar.calendar || {},
      messages: executorMessages.messages || [],
      stats: executorStats || executorDashboard.stats || {},
      profile: me.user || {}
    };
  }
  var customerDashboard = await apiGet("/api/dashboard/customer");
  var customerOrders = await apiGet("/api/orders/customer");
  var customerOffers = await apiGet("/api/offers/customer");
  var favorites = await apiGet("/api/favorites");
  var executors = await apiGet("/api/executors");
  var customerMessages = await apiGet("/api/chat/messages");
  return {
    role: "customer",
    dashboard: customerDashboard,
    week: customerDashboard.week || [0, 0, 0, 0, 0, 0, 0],
    orders: customerOrders.orders || [],
    offers: customerOffers.offers || [],
    favorites: favorites.favorites || [],
    executors: executors.executors || [],
    messages: customerMessages.messages || [],
    profile: me.user || {}
  };
}

function normalizeData(data) {
  var normalized = emptyData();
  Object.keys(normalized).forEach(function (key) {
    if (data && data[key] != null) normalized[key] = data[key];
  });
  ["orders", "offers"].forEach(function (key) {
    if (Array.isArray(normalized[key])) {
      normalized[key] = normalized[key].map(function (item) {
        item.status = normalizeStatus(item.status);
        return item;
      });
    }
  });
  return normalized;
}

function renderRoleLocked() {
  $("#welcomeTitle").textContent = "Роль не выбрана";
  $("#rolePill").textContent = "Откройте из бота";
  $("#tabs").innerHTML = "";
  $$(".view").forEach(function (section) { section.classList.remove("active"); });
  $("#dashboardView").classList.add("active");
  $("#heroTitle").textContent = "Выберите роль в Telegram";
  $("#heroText").textContent = "Нажмите /start в боте и выберите «Заказчик» или «Исполнитель». Mini App откроет только интерфейс выбранной роли.";
  $("#heroActions").innerHTML = "";
  $("#dashboardMetrics").innerHTML = "";
  $("#todayFeed").innerHTML = "";
  $("#weekBars").innerHTML = "";
}

function renderSkeleton() {
  $("#welcomeTitle").textContent = state.role === "executor" ? "Кабинет исполнителя" : "Кабинет заказчика";
  $("#rolePill").textContent = state.role === "executor" ? "Исполнитель" : "Заказчик";
  renderTabs();
}

function renderTabs() {
  var tabs = roleTabs[state.role] || [];
  $("#tabs").innerHTML = tabs.map(function (item) {
    return '<button class="tab" data-view="' + item[0] + '" type="button">' + h(item[1]) + "</button>";
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
  renderCurrentView();
}

function renderAll() {
  renderDashboard();
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
  setView(state.view || "dashboardView");
}

function renderCurrentView() {
  if (state.view === "dashboardView") renderDashboard();
  if (state.view === "builderView") updatePreview();
  if (state.view === "ordersView") renderOrders();
  if (state.view === "marketView") renderMarket();
  if (state.view === "favoritesView") renderFavorites();
  if (state.view === "offersView") renderOffers();
  if (state.view === "chatView") renderChat();
  if (state.view === "calendarView") renderCalendar();
  if (state.view === "portfolioView") renderPortfolio();
  if (state.view === "statsView") renderStats();
  if (state.view === "profileView") renderProfile();
}

function renderDashboard() {
  var isExecutor = state.role === "executor";
  $("#welcomeTitle").textContent = isExecutor ? "Кабинет исполнителя" : "Кабинет заказчика";
  $("#rolePill").textContent = isExecutor ? "Исполнитель" : "Заказчик";
  $("#roleEyebrow").textContent = isExecutor ? "Производство" : "Заказчик";
  $("#heroTitle").textContent = "Добрый день, " + greetingName() + "! " + (isExecutor ? "🔧" : "👋");
  $("#heroText").textContent = state.apiReady
    ? (isExecutor ? "Ваши заказы, предложения и загрузка по реальным данным." : "Ваши заказы, предложения и избранные исполнители по реальным данным.")
    : "Данные из базы появятся после подключения HTTPS API к боту.";
  $("#heroActions").innerHTML = isExecutor
    ? '<button class="primary" data-go="marketView" type="button">🔍 Поиск заказов</button><button class="ghost" data-go="ordersView" type="button">📋 Мои предложения</button>'
    : '<button class="primary" data-go="builderView" type="button">➕ Новый заказ</button><button class="ghost" data-go="marketView" type="button">🔍 Найти исполнителя</button>';

  var d = state.data.dashboard || {};
  var metrics = isExecutor ? [
    ["Доступно новых заказов", number(d.open_orders_count), "status = open"],
    ["Мои активные заказы", number(d.active_orders_count), "executor_id = user_id"],
    ["Выполнено за месяц", number(d.completed_month_count), "status = completed"],
    ["Рейтинг", d.rating ? d.rating + " ★" : "0 ★", "из профиля"]
  ] : [
    ["Активных заказов", number(d.active_orders_count), "open / in_progress"],
    ["Новых предложений", number(d.pending_offers_count), "pending"],
    ["Исполнителей в избранном", number(d.favorites_count), "ваш список"],
    ["Заказов за неделю", sum(state.data.week), "создано"]
  ];
  $("#dashboardMetrics").innerHTML = metrics.map(metricCard).join("");
  renderBars();
  renderFeed();
}

function metricCard(item) {
  return '<article class="metric"><span>' + h(item[0]) + '</span><strong>' + h(item[1]) + '</strong><small>' + h(item[2]) + '</small></article>';
}

function renderBars() {
  var values = Array.isArray(state.data.week) ? state.data.week : [0, 0, 0, 0, 0, 0, 0];
  var max = Math.max.apply(null, values.concat([1]));
  var days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  $("#activityTitle").textContent = state.role === "executor" ? "Загрузка за неделю" : "Активность за неделю";
  $("#activityBadge").textContent = state.apiReady ? "по базе" : "нет API";
  $("#weekBars").innerHTML = values.map(function (value, index) {
    var height = Math.max(12, Math.round(value / max * 100));
    return '<div class="bar"><i style="height:' + height + '%"></i><span>' + days[index] + '</span><b>' + number(value) + '</b></div>';
  }).join("");
}

function renderFeed() {
  var items = state.role === "executor" ? state.data.notifications : state.data.notifications;
  if (!items || !items.length) {
    $("#profileFill").textContent = state.apiReady ? "Нет новых событий" : "API не подключен";
    $("#todayFeed").innerHTML = emptyInline("Событий пока нет.");
    return;
  }
  $("#profileFill").textContent = items.length + " событий";
  $("#todayFeed").innerHTML = items.slice(0, 4).map(function (item) {
    return '<button class="event as-button" data-go="' + h(item.view || "ordersView") + '" type="button"><i>🔔</i><p>' + h(item.text) + '</p></button>';
  }).join("");
}

function updatePreview() {
  var qty = $("#orderQty").value ? $("#orderQty").value + " шт." : "-";
  var deadline = $("#orderDeadline").value || "-";
  var budget = $("#negotiableBudget").checked ? "Договорной" : buildBudget();
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
    return '<div class="step ' + (filled[index] ? "active" : "") + '"><b>' + (index + 1) + '</b><span>' + h(label) + '</span></div>';
  }).join("");
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
  var score = 0;
  if ($("#orderTitle").value.trim()) score += 18;
  if ($("#orderDescription").value.trim().length > 20) score += 24;
  if ($("#orderCity").value.trim()) score += 14;
  if ($("#orderQty").value) score += 12;
  if ($("#orderDeadline").value) score += 14;
  if ($("#negotiableBudget").checked || $("#budgetFrom").value || $("#budgetTo").value) score += 12;
  if ($("#orderFiles").files && $("#orderFiles").files.length) score += Math.min($("#orderFiles").files.length, 5) * 2;
  return Math.min(score, 100);
}

function orderPayload() {
  return {
    type: "create_order",
    title: $("#orderTitle").value.trim(),
    description: $("#orderDescription").value.trim(),
    material: state.material,
    quantity: Number($("#orderQty").value || 0),
    budget: $("#negotiableBudget").checked ? "Договорной" : buildBudget(),
    city: $("#orderCity").value.trim(),
    deadline: $("#orderDeadline").value,
    payment_terms: $("#orderPayment").value
  };
}

async function publishOrder() {
  var payload = orderPayload();
  debugLog("CLICK publishOrder");
  if (!payload.title || !payload.description || !payload.quantity || !payload.budget || !payload.city || !payload.deadline) {
    showToast("Заполните название, описание, количество, город, срок и бюджет.");
    return;
  }
  if ($("#orderFiles").files && $("#orderFiles").files.length > 5) {
    showToast("Можно приложить до 5 файлов.");
    return;
  }
  try {
    if ($("#orderFiles").files && $("#orderFiles").files[0]) {
      payload.file_id = await readFileAsDataUrl($("#orderFiles").files[0]);
      payload.file_type = "image_data";
      debugLog("ORDER file attached name=" + $("#orderFiles").files[0].name);
    }
    if (API_BASE) await apiPost("/api/orders/create", payload);
    else if (tg && tg.sendData) tg.sendData(JSON.stringify(payload));
    showToast("Заказ отправлен.");
    await loadData();
  } catch (error) {
    debugLog("ORDER ERROR " + error.message);
    showToast("Не удалось отправить заказ: " + error.message);
  }
}

function renderOrders() {
  var isExecutor = state.role === "executor";
  $("#ordersTitle").textContent = isExecutor ? "Мои предложения" : "Мои заказы";
  var tabs = isExecutor
    ? [["pending", "⏳ Ожидает"], ["accepted", "✅ Принято"], ["declined", "❌ Отклонено"]]
    : [["open", "🟢 Активные"], ["in_progress", "🟡 В работе"], ["completed", "✅ Выполненные"]];
  $("#orderSubtabs").innerHTML = tabs.map(function (tab) {
    return '<button class="subtab ' + (state.orderTab === tab[0] ? "active" : "") + '" data-tab="' + h(tab[0]) + '" type="button">' + h(tab[1]) + "</button>";
  }).join("");
  $$("#orderSubtabs .subtab").forEach(function (button) {
    button.addEventListener("click", function () {
      state.orderTab = button.dataset.tab;
      renderOrders();
    });
  });

  var rows = isExecutor ? state.data.offers : state.data.orders;
  rows = Array.isArray(rows) ? rows : [];
  var filtered = rows.filter(function (item) { return !state.orderTab || item.status === state.orderTab; });
  $("#ordersList").innerHTML = filtered.map(isExecutor ? offerRow : orderRow).join("") ||
    emptyPanel(isExecutor ? "Предложений пока нет" : "Заказов пока нет", isExecutor ? "Откройте поиск заказов и отправьте первое предложение." : "Создайте первый заказ, чтобы получать предложения.");
}

function orderRow(order) {
  return '<article class="order-card">' +
    '<div class="card-head"><div><h3>#' + h(order.id) + ' ' + h(order.title) + '</h3><p>' + h(order.created_at || "") + ' · ' + h(order.budget || "бюджет не указан") + '</p></div><span class="status ' + statusClass(order.status) + '">' + h(statusLabel(order.status)) + '</span></div>' +
    '<div class="tags"><span class="tag">' + h(order.material || "Материал не указан") + '</span><span class="tag">' + h(order.quantity || 0) + ' шт.</span><span class="tag">Предложений: ' + h(order.offers_count || 0) + '</span></div>' +
    '<div class="card-actions"><button class="primary small" data-action="view-offers" data-order="' + h(order.id) + '" type="button">Смотреть предложения</button><button class="ghost" data-action="select-chat" data-order="' + h(order.id) + '" type="button">💬 Чат</button><button class="ghost" data-action="complete-order" data-order="' + h(order.id) + '" type="button">Завершить</button></div></article>';
}

function offerRow(offer) {
  return '<article class="order-card">' +
    '<div class="card-head"><div><h3>#' + h(offer.order_id) + ' ' + h(offer.order_title || "Заказ") + '</h3><p>' + h(offer.city || "") + ' · ' + h(offer.price || "цена не указана") + '</p></div><span class="status ' + statusClass(offer.status) + '">' + h(offerStatus(offer.status)) + '</span></div>' +
    '<p>' + h(offer.comment || "") + '</p><div class="card-actions"><button class="ghost" data-action="select-chat" data-order="' + h(offer.order_id) + '" type="button">💬 Написать заказчику</button></div></article>';
}

function renderMarket() {
  var isExecutor = state.role === "executor";
  $("#marketTitle").textContent = isExecutor ? "Поиск заказов" : "Поиск исполнителей";
  renderMarketFilters();
  if (isExecutor) renderOpenOrders();
  else renderExecutors();
}

function renderMarketFilters() {
  var isExecutor = state.role === "executor";
  var selectedWork = $("#workFilter").value;
  var selectedRange = $("#ratingFilter") ? $("#ratingFilter").value : "0";
  $("#workFilter").innerHTML = (isExecutor ? ["", "Сталь", "Алюминий", "Титан", "Пластик"] : ["", "токарка", "фрезеровка", "сварка", "лазер"]).map(function (value) {
    return '<option value="' + h(value) + '">' + h(value || (isExecutor ? "Все материалы" : "Все работы")) + '</option>';
  }).join("");
  if ([].some.call($("#workFilter").options, function (option) { return option.value === selectedWork; })) {
    $("#workFilter").value = selectedWork;
  }
  $(".range").innerHTML = isExecutor
    ? 'Срочность <span id="ratingValue">любая</span><input id="ratingFilter" type="range" min="0" max="3" step="1" value="0">'
    : 'Рейтинг от <span id="ratingValue">0</span><input id="ratingFilter" type="range" min="0" max="5" step="0.1" value="0">';
  $("#ratingFilter").value = selectedRange;
  $("#ratingFilter").addEventListener("input", renderMarket);
}

function renderOpenOrders() {
  var city = $("#cityFilter").value;
  var material = $("#workFilter").value;
  var rows = (state.data.orders || []).filter(function (order) {
    return order.status === "open" && (!city || order.city === city) && (!material || order.material === material);
  });
  $("#marketCards").innerHTML = rows.map(function (order) {
    return '<article class="entity-card order-search-card"><div class="drawing-preview"><span>' + h(order.file_preview || "чертеж") + '</span></div>' +
      '<div class="card-head"><div><h3>#' + h(order.id) + ' ' + h(order.title) + '</h3><p>' + h(order.customer_name || "Заказчик") + ' · ' + h(order.city || "") + ' · до ' + h(order.deadline || "") + '</p></div><span class="badge neutral">' + h(order.material || "") + '</span></div>' +
      '<div class="tags"><span class="tag">' + h(order.quantity || 0) + ' шт.</span><span class="tag">срочность: ' + h(order.urgency || "не указана") + '</span><span class="tag">' + h(order.budget || "бюджет не указан") + '</span></div>' +
      '<div class="card-actions"><button class="primary small" data-action="open-offer" data-order="' + h(order.id) + '" type="button">💰 Сделать предложение</button></div></article>';
  }).join("") || emptyPanel("Открытых заказов нет", "Подходящих заказов по фильтрам не найдено.");
}

function renderExecutors() {
  var city = $("#cityFilter").value;
  var work = $("#workFilter").value;
  var minRating = Number($("#ratingFilter").value || 0);
  $("#ratingValue").textContent = minRating.toFixed(1);
  var rows = (state.data.executors || []).filter(function (executor) {
    return (!city || executor.city === city) && (!work || (executor.specialization || "").toLowerCase().indexOf(work) !== -1) && Number(executor.rating || 0) >= minRating;
  });
  $("#marketCards").innerHTML = rows.map(function (executor) {
    return '<article class="entity-card"><div class="card-head"><div class="avatar">' + h((executor.company || "?").slice(0, 2).toUpperCase()) + '</div><div><h3>' + h(executor.company || "Исполнитель") + '</h3><p>' + h(executor.city || "") + ' · ' + h(executor.rating || 0) + ' ★</p></div></div>' +
      '<div class="tags"><span class="tag">' + h(executor.specialization || "специализация не указана") + '</span></div>' +
      '<div class="card-actions"><button class="primary small" data-action="favorite" data-executor="' + h(executor.id) + '" type="button">❤️ В избранное</button><button class="ghost" data-action="select-chat-user" data-user="' + h(executor.id) + '" type="button">💬 Написать</button></div></article>';
  }).join("") || emptyPanel("Исполнители не найдены", "Попробуйте изменить фильтры.");
}

function renderFavorites() {
  var rows = state.data.favorites || [];
  $("#favoritesCount").textContent = rows.length + " сохранено";
  $("#favoritesList").innerHTML = rows.map(function (executor) {
    return '<article class="order-card"><div class="card-head"><div><h3>' + h(executor.company || "Исполнитель") + '</h3><p>' + h(executor.city || "") + ' · ' + h(executor.rating || 0) + ' ★</p></div><button class="ghost" data-action="remove-favorite" data-executor="' + h(executor.id) + '" type="button">Удалить</button></div>' +
      '<div class="card-actions"><button class="primary small" data-go="builderView" type="button">Создать заказ для этого исполнителя</button></div></article>';
  }).join("") || emptyPanel("Избранное пустое", "Добавляйте исполнителей из поиска кнопкой «❤️ В избранное».");
}

function renderOffers() {
  if (state.role === "executor") {
    $("#offersTitle").textContent = "Уведомления";
    $("#offersBadge").textContent = (state.data.notifications || []).length + " событий";
    $("#offersList").innerHTML = (state.data.notifications || []).map(function (item) {
      return '<article class="order-card notice-card"><button class="event as-button" data-action="select-chat" data-order="' + h(item.order_id || "") + '" type="button"><i>🔔</i><p>' + h(item.text) + '</p></button></article>';
    }).join("") || emptyPanel("Уведомлений нет", "Новые события появятся здесь.");
    return;
  }
  $("#offersTitle").textContent = "Предложения от исполнителей";
  $("#offersBadge").textContent = (state.data.offers || []).length + " всего";
  $("#offersList").innerHTML = (state.data.offers || []).map(function (offer) {
    return '<article class="order-card"><div class="card-head"><div><h3>' + h(offer.executor_company || "Исполнитель") + '</h3><p>' + h(offer.rating || 0) + ' ★ · ' + h(offer.deadline || "срок не указан") + '</p></div><strong>' + h(offer.price || "") + '</strong></div><p>' + h(offer.comment || "") + '</p><div class="card-actions"><button class="primary small" data-action="accept-offer" data-offer="' + h(offer.id) + '" type="button">✅ Принять</button><button class="ghost" data-action="decline-offer" data-offer="' + h(offer.id) + '" type="button">❌ Отказать</button></div></article>';
  }).join("") || emptyPanel("Предложений пока нет", "Когда исполнители откликнутся, они появятся здесь.");
}

function renderChat() {
  var order = findOrder(state.selectedOrderId);
  $("#chatOrderId").textContent = order ? "#" + order.id : "Заказ";
  $("#chatOrderTitle").textContent = order ? order.title : "Не выбран";
  $("#chatOrderMeta").textContent = order ? [order.city, order.quantity ? order.quantity + " шт." : "", order.budget].filter(Boolean).join(" · ") : "Откройте чат из карточки заказа";
  $("#chatTitle").textContent = order ? "Чат по заказу #" + order.id : "Чат по заказу";
  $("#chatMeta").textContent = order ? "История сообщений по выбранному заказу." : "Сообщения загружаются только по конкретному заказу.";
  $("#chatInput").disabled = !order;
  $("#chatForm button").disabled = !order;
  var messages = state.selectedOrderId ? (state.data.messages || []).filter(function (message) { return String(message.order_id) === String(state.selectedOrderId); }) : [];
  $("#messages").innerHTML = messages.map(function (message) {
    var me = String(message.sender_id) === String(state.user.id);
    return '<div class="bubble ' + (me ? "me" : "") + '">' + h(message.text) + '</div>';
  }).join("") || emptyPanel("Сообщений нет", order ? "Напишите первое сообщение по заказу." : "Сначала выберите заказ.");
  $("#quickReplies").innerHTML = (state.role === "executor" ? ["Перенести срок", "Завершить заказ"] : ["Когда сделаете?", "Пришлите примеры работ"]).map(function (text) {
    return '<button type="button">' + h(text) + '</button>';
  }).join("");
  $$("#quickReplies button").forEach(function (button) {
    button.addEventListener("click", function () {
      $("#chatInput").value = button.textContent;
      $("#chatInput").focus();
    });
  });
}

function renderCalendar() {
  var now = new Date();
  $("#calendarMonth").textContent = now.toLocaleString("ru-RU", { month: "long", year: "numeric" });
  var daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  var labels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  var cells = labels.map(function (label) { return '<div class="calendar-label">' + label + '</div>'; });
  for (var day = 1; day <= daysInMonth; day += 1) {
    var dateKey = calendarDateKey(now, day);
    var status = (state.data.calendar || {})[dateKey] || (state.data.calendar || {})[day] || "free";
    cells.push('<button class="day ' + h(status) + '" data-action="calendar-day" data-day="' + h(dateKey) + '" type="button" aria-label="' + h(day + " " + dayLabel(status)) + '"><b>' + day + '</b><span>' + h(dayLabel(status)) + '</span></button>');
  }
  $("#calendarGrid").innerHTML = cells.join("");
}

function renderPortfolio() {
  var rows = state.data.portfolio || [];
  $("#portfolioGrid").innerHTML = rows.map(function (item) {
    var preview = item.file_id && String(item.file_id).indexOf("data:image/") === 0
      ? '<img src="' + h(item.file_id) + '" alt="">'
      : '<span>' + h(item.file_id || "Фото") + '</span>';
    return '<article class="portfolio-card steel"><div>' + preview + '</div><h3>' + h(item.title || "Работа") + '</h3><p>' + h(item.description || item.equipment || "") + '</p><button class="ghost" data-action="remove-portfolio" data-item="' + h(item.id) + '" type="button">Удалить</button></article>';
  }).join("") || emptyPanel("Портфолио пустое", "Добавьте фото работ, описание оборудования и станков.");
  $("#reviewsList").innerHTML = (state.data.reviews || []).map(function (review) {
    return '<article class="order-card"><div class="card-head"><h3>' + h(review.author || "Заказчик") + '</h3><span class="status done">' + h(review.stars || 0) + ' ★</span></div><p>' + h(review.text || "") + '</p></article>';
  }).join("");
}

function renderStats() {
  var s = state.data.stats || {};
  $("#financeTotal").textContent = money(s.total_earned || 0);
  if ($("#statsFilters")) $("#statsFilters").innerHTML = [
    ["week", "Неделя"],
    ["month", "Месяц"],
    ["year", "Год"]
  ].map(function (item) {
    return '<button class="subtab ' + (state.statsPeriod === item[0] ? "active" : "") + '" data-action="stats-period" data-period="' + item[0] + '" type="button">' + item[1] + '</button>';
  }).join("");
  $("#statsMetrics").innerHTML = [
    ["Заказов выполнено", number(s.completed_orders), "по базе"],
    ["Средний чек", money(s.average_check || 0), "по завершенным"],
    ["Всего заработано", money(s.total_earned || 0), "accepted/completed"],
    ["Конверсия", percent(s.conversion || 0), "предложения → заказы"]
  ].map(metricCard).join("");
  $("#statsFunnel").innerHTML = [
    ["Отправлено предложений", number(s.offers_sent)],
    ["Принято", number(s.offers_accepted)],
    ["Завершено", number(s.completed_orders)]
  ].map(function (row) {
    return '<div><span>' + h(row[0]) + '</span><i><em style="width:' + Math.min(Number(row[1]) || 0, 100) + '%"></em></i><b>' + h(row[1]) + '</b></div>';
  }).join("");
  $("#financeFeed").innerHTML = emptyInline("Финансовая сводка появится после завершенных заказов.");
}

function renderProfile() {
  var p = state.data.profile || {};
  $("#profileTitle").textContent = state.role === "executor" ? "Профиль исполнителя" : "Профиль заказчика";
  var rows = state.role === "executor"
    ? [["Компания", "company", p.company], ["Город", "city", p.city], ["Специализация", "specialization", p.specialization], ["Телефон", "phone", p.phone], ["График", "work_schedule", p.work_schedule], ["Рейтинг", "rating", (p.rating || 0) + " ★"]]
    : [["Имя", "name", greetingName()], ["Компания", "company", p.company], ["Город", "city", p.city], ["Телефон", "phone", p.phone], ["Тип", "customer_type", p.company ? "Юрлицо" : "Физлицо"]];
  $("#profileCard").innerHTML = rows.map(function (row) {
    var readonly = row[1] === "rating" || row[1] === "customer_type" ? " readonly" : "";
    return '<label>' + h(row[0]) + '<input data-profile="' + h(row[1]) + '" value="' + h(row[2] || "") + '"' + readonly + '></label>';
  }).join("") + '<button class="primary" data-action="save-profile" type="button">Сохранить профиль</button>';
}

function openOffer(orderId) {
  state.selectedOrderId = orderId;
  $("#offerModalTitle").textContent = "Предложение по заказу #" + orderId;
  $("#offerPrice").value = "";
  $("#offerDays").value = "";
  $("#offerComment").value = "";
  if ($("#offerModal").showModal) $("#offerModal").showModal();
  else $("#offerModal").setAttribute("open", "");
}

async function submitOffer(event) {
  event.preventDefault();
  if (event.submitter && event.submitter.value === "cancel") {
    closeOfferModal();
    return;
  }
  if (!$("#offerPrice").value || !$("#offerComment").value.trim()) {
    showToast("Заполните цену и комментарий.");
    return;
  }
  try {
    await apiPost("/api/offers/create", {
      order_id: state.selectedOrderId,
      price: $("#offerPrice").value,
      deadline_days: $("#offerDays").value,
      comment: $("#offerComment").value.trim()
    });
    closeOfferModal();
    showToast("Предложение отправлено.");
    await loadData();
  } catch (error) {
    debugLog("OFFER ERROR " + error.message);
    showToast("Не удалось отправить предложение: " + error.message);
  }
}

function closeOfferModal() {
  if ($("#offerModal").close) $("#offerModal").close();
  else $("#offerModal").removeAttribute("open");
}

function clearOrderForm() {
  ["orderTitle", "orderCity", "orderDescription", "orderQty", "orderDeadline", "budgetFrom", "budgetTo"].forEach(function (id) {
    $("#" + id).value = "";
  });
  $("#negotiableBudget").checked = false;
  updatePreview();
}

function initEvents() {
  document.addEventListener("click", logInternalClick, true);
  document.addEventListener("submit", logInternalSubmit, true);
  attachStaticButtonLogs();
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
  $("#clearOrderBtn").addEventListener("click", clearOrderForm);
  $("#cityFilter").addEventListener("change", renderMarket);
  $("#workFilter").addEventListener("change", renderMarket);
  $("#offerForm").addEventListener("submit", submitOffer);
  $("#quickOfferBtn").addEventListener("click", function () {
    $("#offerPrice").value = "";
    $("#offerDays").value = "";
    $("#offerComment").value = "Готов рассчитать после уточнения чертежа и материала.";
  });
  $("#portfolioAddBtn").addEventListener("click", addPortfolio);
  $("#portfolioPhoto").addEventListener("change", function () {
    var file = $("#portfolioPhoto").files && $("#portfolioPhoto").files[0];
    debugLog("INPUT portfolioPhoto file=" + (file ? file.name : ""));
  });
  $("#sharePortfolioBtn").addEventListener("click", function () { showToast("Ссылка на портфолио появится после подключения API."); });
  $("#chatForm").addEventListener("submit", sendChatMessage);
  $("#supportBtn").addEventListener("click", function () {
    if (tg && tg.openTelegramLink) tg.openTelegramLink("https://t.me/valentinn_nikonov");
    else showToast("Поддержка откроется внутри Telegram.");
  });
  $("#attachBtn").addEventListener("click", function () { showToast("Загрузка фото подключается через файловый API."); });
  $("#checkApiBtn").addEventListener("click", checkApi);
  $("#manualApiSaveBtn").addEventListener("click", function () {
    setApiUrl($("#manualApiUrl").value);
  });
  document.addEventListener("click", handleActionClick);
  updateApiTools();
}

async function sendChatMessage(event) {
  event.preventDefault();
  debugLog("SUBMIT chatForm order_id=" + (state.selectedOrderId || ""));
  var text = $("#chatInput").value.trim();
  if (!state.selectedOrderId) {
    showToast("Сначала выберите заказ для чата.");
    return;
  }
  if (!text) return;
  try {
    await apiPost("/api/chat/messages", { order_id: state.selectedOrderId, text: text });
    $("#chatInput").value = "";
    await loadChatMessages(state.selectedOrderId);
    setView("chatView");
  } catch (error) {
    debugLog("CHAT ERROR " + error.message);
    showToast("Не удалось отправить сообщение: " + error.message);
  }
}

async function handleActionClick(event) {
  var button = event.target.closest("[data-go], [data-action]");
  if (!button) return;
  debugLog("CLICK action=" + (button.dataset.action || "") + " go=" + (button.dataset.go || "") + " id=" + (button.id || ""));
  if (button.dataset.go) {
    setView(button.dataset.go);
    return;
  }
  var action = button.dataset.action;
  if (action === "open-offer") openOffer(button.dataset.order);
  if (action === "select-chat" || action === "view-offers") {
    state.selectedOrderId = button.dataset.order;
    if (action === "select-chat") await loadChatMessages(state.selectedOrderId);
    setView(action === "view-offers" ? "offersView" : "chatView");
  }
  if (action === "complete-order") await actionPost("/api/orders/complete", { order_id: button.dataset.order });
  if (action === "accept-offer") await actionPost("/api/offers/accept", offerAcceptPayload(button.dataset.offer));
  if (action === "decline-offer") await actionPost("/api/offers/decline", { offer_id: button.dataset.offer });
  if (action === "favorite") await actionPost("/api/favorites/add", { executor_id: button.dataset.executor });
  if (action === "remove-favorite") await actionDelete("/api/favorites?executor_id=" + encodeURIComponent(button.dataset.executor));
  if (action === "calendar-day") openCalendarStatusMenu(button.dataset.day);
  if (action === "calendar-status") await setCalendarDay(state.pendingCalendarDay, button.dataset.status);
  if (action === "calendar-cancel") closeCalendarStatusMenu();
  if (action === "save-profile") await saveProfile();
  if (action === "remove-portfolio") await actionDelete("/api/portfolio?portfolio_id=" + encodeURIComponent(button.dataset.item));
  if (action === "choose-portfolio-photo") $("#portfolioPhoto").click();
  if (action === "stats-period") await setStatsPeriod(button.dataset.period);
}

async function addPortfolio() {
  var fileId = $("#portfolioFileId").value.trim();
  var text = $("#portfolioText").value.trim();
  var fileInput = $("#portfolioPhoto");
  if (!text) {
    showToast("Заполните описание работы, оборудование или станок.");
    return;
  }
  if (!fileId && fileInput && fileInput.files && fileInput.files[0]) {
    fileId = await readFileAsDataUrl(fileInput.files[0]);
  }
  if (!fileId) {
    showToast("Добавьте фото или укажите file_id.");
    return;
  }
  debugLog("SUBMIT portfolio file=" + (fileId ? "yes" : "no") + " text_length=" + text.length);
  await actionPost("/api/portfolio/add", { file_id: fileId, text: text, file_type: fileId.indexOf("data:image/") === 0 ? "image_data" : "photo" });
  $("#portfolioFileId").value = "";
  $("#portfolioText").value = "";
  if (fileInput) fileInput.value = "";
}

async function actionPost(path, body) {
  try {
    await apiPost(path, body);
    await loadData();
  } catch (error) {
    debugLog("ACTION ERROR " + error.message);
    showToast("Действие не выполнено: " + error.message);
  }
}

async function actionDelete(path) {
  try {
    await apiDelete(path);
    await loadData();
  } catch (error) {
    debugLog("DELETE ERROR " + error.message);
    showToast("Действие не выполнено: " + error.message);
  }
}

function offerAcceptPayload(offerId) {
  var offer = (state.data.offers || []).find(function (item) { return String(item.id) === String(offerId); }) || {};
  return {
    offer_id: offerId,
    order_id: offer.order_id,
    executor_id: offer.executor_id
  };
}

function openCalendarStatusMenu(day) {
  state.pendingCalendarDay = day;
  $("#calendarStatusDate").textContent = formatDateRu(day);
  if ($("#calendarStatusModal").showModal) $("#calendarStatusModal").showModal();
  else $("#calendarStatusModal").setAttribute("open", "");
}

function closeCalendarStatusMenu() {
  state.pendingCalendarDay = null;
  if ($("#calendarStatusModal").close) $("#calendarStatusModal").close();
  else $("#calendarStatusModal").removeAttribute("open");
}

async function setCalendarDay(day, status) {
  if (!day || !status) return;
  state.data.calendar[day] = status;
  renderCalendar();
  closeCalendarStatusMenu();
  await actionPost("/api/calendar/set", { day: day, status: status });
}

async function setStatsPeriod(period) {
  state.statsPeriod = period || "month";
  debugLog("CLICK stats-period=" + state.statsPeriod);
  try {
    state.data.stats = await apiGet("/api/stats/executor?period=" + encodeURIComponent(state.statsPeriod));
    renderStats();
  } catch (error) {
    debugLog("STATS ERROR " + error.message);
    showToast("Не удалось загрузить статистику: " + error.message);
  }
}

function formatDateRu(day) {
  if (!day) return "";
  var parts = String(day).split("-");
  if (parts.length !== 3) return day;
  return parts[2] + "." + parts[1] + "." + parts[0];
}

function calendarDateKey(date, day) {
  var month = String(date.getMonth() + 1).padStart(2, "0");
  var dayText = String(day).padStart(2, "0");
  return date.getFullYear() + "-" + month + "-" + dayText;
}

function readFileAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveProfile() {
  var payload = {};
  $$("[data-profile]").forEach(function (input) {
    payload[input.dataset.profile] = input.value.trim();
  });
  delete payload.rating;
  delete payload.customer_type;
  delete payload.name;
  debugLog("SUBMIT profile " + JSON.stringify(payload));
  await actionPost("/api/profile/update", payload);
}

function findOrder(id) {
  var order = (state.data.orders || []).find(function (item) { return String(item.id) === String(id); });
  if (order) return order;
  var offer = (state.data.offers || []).find(function (item) { return String(item.order_id) === String(id); });
  if (!offer) return null;
  return {
    id: offer.order_id,
    title: offer.order_title || "Заказ",
    city: offer.city || "",
    budget: offer.budget || offer.price || ""
  };
}

async function loadChatMessages(orderId) {
  if (!orderId) return;
  try {
    var data = await apiGet("/api/chat/messages?order_id=" + encodeURIComponent(orderId));
    state.data.messages = data.messages || [];
    debugLog("LOAD chat order_id=" + orderId + " messages=" + state.data.messages.length);
  } catch (error) {
    debugLog("CHAT LOAD ERROR " + error.message);
    showToast("Не удалось загрузить чат: " + error.message);
  }
}

function logInternalClick(event) {
  var target = event.target.closest("button, input, select, textarea, [data-action], [data-go]");
  if (!target) return;
  var name = buttonName(target);
  debugLog("Кнопка " + name + " нажата");
  debugLog("EVENT click tag=" + target.tagName.toLowerCase() + " id=" + (target.id || "") + " action=" + (target.dataset ? target.dataset.action || "" : ""));
}

function logInternalSubmit(event) {
  debugLog("EVENT submit id=" + (event.target.id || ""));
}

function attachStaticButtonLogs() {
  $$("button").forEach(function (button) {
    if (button.dataset.staticLogBound === "1") return;
    button.dataset.staticLogBound = "1";
    button.addEventListener("click", function () {
      debugLog("STATIC button listener: " + buttonName(button));
    });
  });
}

function buttonName(button) {
  return button.id || (button.dataset && (button.dataset.action || button.dataset.go)) || button.textContent.trim() || "без имени";
}

function updateApiTools() {
  var panel = $("#apiMissingPanel");
  var input = $("#manualApiUrl");
  if (panel) panel.hidden = !!API_BASE;
  if (input && !input.value) input.value = API_BASE || "";
}

async function checkApi() {
  debugLog("Кнопка Проверить API нажата");
  if (!ensureApiConfigured()) return;
  var testUserId = state.user.id || explicitUserId || "1";
  try {
    var data = await apiGet("/api/me?user_id=" + encodeURIComponent(testUserId));
    debugLog("Проверка API OK: " + JSON.stringify(data));
    showToast("API отвечает.");
  } catch (error) {
    debugLog("Проверка API ошибка: " + error.message, "error");
    showToast("API ошибка: " + error.message);
  }
}

function statusLabel(status) {
  var labels = { open: "Открыт", in_progress: "В работе", completed: "Выполнен", pending: "Ожидает", accepted: "Принято", declined: "Отклонено" };
  return labels[status] || status || "Не указан";
}

function normalizeStatus(status) {
  var map = { new: "open", work: "in_progress", done: "completed" };
  return map[status] || status || "";
}

function offerStatus(status) {
  return statusLabel(status);
}

function statusClass(status) {
  if (status === "completed" || status === "accepted") return "done";
  if (status === "in_progress" || status === "pending") return "warn";
  if (status === "declined") return "bad";
  return "";
}

function dayLabel(status) {
  var labels = { free: "свободный", busy: "занятой", partial: "частичный", reserve: "резерв" };
  return labels[status] || "свободный";
}

function emptyPanel(title, text) {
  return '<article class="panel empty"><h2>' + h(title) + '</h2><p>' + h(text) + '</p></article>';
}

function emptyInline(text) {
  return '<div class="empty-inline">' + h(text) + '</div>';
}

function number(value) {
  return Number(value || 0).toLocaleString("ru-RU");
}

function money(value) {
  return Number(value || 0).toLocaleString("ru-RU") + " ₽";
}

function percent(value) {
  return Math.round(Number(value || 0) * 100) + "%";
}

function sum(values) {
  return (values || []).reduce(function (acc, value) { return acc + Number(value || 0); }, 0);
}

function showToast(message) {
  debugLog("TOAST " + message);
  if (tg && tg.showPopup) tg.showPopup({ message: message });
  else window.alert(message);
}

function debugLog(message, level) {
  level = level || "info";
  if (window.console && console.log) {
    if (level === "error" && console.error) console.error("[MiniApp]", message);
    else console.log("[MiniApp]", message);
  }
  if (!debugEnabled) return;
  if (typeof $ !== "function" || !document.body) return;
  var box = $("#debugConsole");
  if (!box) {
    box = document.createElement("div");
    box.id = "debugConsole";
    box.className = "debug-console";
    document.body.appendChild(box);
  }
  var line = document.createElement("div");
  line.className = level === "error" ? "debug-line error" : "debug-line";
  line.textContent = new Date().toLocaleTimeString("ru-RU") + " " + message;
  box.appendChild(line);
  while (box.children.length > 30) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
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

initEvents();
loadData();

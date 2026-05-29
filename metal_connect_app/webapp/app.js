window.onerror = function(msg, url, line, col, error) {
  return false;
};

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
  document.body.classList.toggle("theme-dark", tg.colorScheme === "dark");
}

var $ = function (selector) { return document.querySelector(selector); };
var $$ = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };
var params = new URLSearchParams(window.location.search);
var explicitUserId = params.get("user_id");
var API_BASE = "";
var REQUEST_TIMEOUT_MS = 60000;

var state = {
  role: normalizeRole(params.get("role") || safeGet("mc_role", "")),
  user: telegramUser(),
  view: params.get("view") || safeGet("mc_view", "") || "dashboardView",
  orderTab: "open",
  statsPeriod: "month",
  material: "Сталь",
  selectedOrderId: params.get("order_id") || null,
  offerFilterOrderId: params.get("order_id") || null,
  pendingCalendarDay: null,
  data: emptyData(),
  apiReady: false,
  pagination: {
    customerOrders: { limit: 20, offset: 0, hasMore: false, loading: false },
    openOrders: { limit: 20, offset: 0, hasMore: false, loading: false }
  },
  pollBusy: false,
  chatPollBusy: false
};

API_BASE = resolveApiUrl();
var roleTabs = {
  customer: [
    ["homeView", "Меню"],
    ["dashboardView", "Главная"],
    ["builderView", "Новый заказ"],
    ["ordersView", "Мои заказы"],
    ["offersView", "Предложения"],
    ["marketView", "Исполнители"],
    ["favoritesView", "Избранное"],
    ["chatView", "Чат"],
    ["profileView", "Профиль"]
  ],
  executor: [
    ["homeView", "Меню"],
    ["dashboardView", "Главная"],
    ["marketView", "Поиск заказов"],
    ["ordersView", "Мои предложения"],
    ["calendarView", "Календарь"],
    ["offersView", "Уведомления"],
    ["profileView", "Мой профиль"],
    ["statsView", "Статистика"],
    ["chatView", "Чат"]
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
  var user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : {};
  return {
    id: user.id || explicitUserId || "",
    first_name: user.first_name || "",
    username: user.username || "",
    photo_url: user.photo_url || ""
  };
}

function greetingName() {
  return state.user.first_name || state.user.username || "";
}

function resolveApiUrl() {
  var raw = params.get("api") || window.DEFAULT_API_URL || safeGet("mc_api_url", "");
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
    updateApiTools();
    loadData();
    return true;
  }
  updateApiTools();
  return false;
}

function ensureApiConfigured() {
  updateApiTools();
  if (API_BASE) return true;
  return false;
}

function apiHeaders() {
  var headers = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" };
  if (tg && tg.initData) headers["X-Telegram-Init-Data"] = tg.initData;
  return headers;
}

async function apiGet(path) {
  if (!API_BASE) throw new Error("API не настроен");
  var url = API_BASE + withUserId(path);
  var response = await fetchWithTimeout(url, { headers: apiHeaders() });
  if (!response.ok) throw new Error(await apiError(response));
  return response.json();
}

async function apiPost(path, body) {
  if (!API_BASE) throw new Error("API не настроен");
  body = withUserBody(body);
  var url = API_BASE + path;
  var response = await fetchWithTimeout(url, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(body || {})
  });
  if (!response.ok) throw new Error(await apiError(response));
  return response.json();
}

async function apiDelete(path) {
  if (!API_BASE) throw new Error("API не настроен");
  var url = API_BASE + withUserId(path);
  var response = await fetchWithTimeout(url, {
    method: "DELETE",
    headers: apiHeaders()
  });
  if (!response.ok) throw new Error(await apiError(response));
  return response.json();
}

async function fetchWithTimeout(url, options) {
  var lastError = null;
  for (var attempt = 0; attempt < 2; attempt += 1) {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    var requestOptions = Object.assign({}, options || {}, { signal: controller.signal });
    try {
      return await fetch(url, requestOptions);
    } catch (error) {
      lastError = error;
      if (attempt || (error.name !== "AbortError" && error.name !== "TypeError")) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
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
  var next = path;
  if (userId && next.indexOf("user_id=") === -1) {
    next += (next.indexOf("?") === -1 ? "?" : "&") + "user_id=" + encodeURIComponent(userId);
  }
  if (state.role && next.indexOf("role=") === -1) {
    next += (next.indexOf("?") === -1 ? "?" : "&") + "role=" + encodeURIComponent(state.role);
  }
  return next;
}

function withUserBody(body) {
  var payload = body || {};
  if (!payload.user_id) payload.user_id = state.user.id || explicitUserId || "";
  if (!payload.role && state.role) payload.role = state.role;
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
    var data = await apiGet("/api/bootstrap?role=" + encodeURIComponent(state.role));
    state.apiReady = true;
    var loadedRole = normalizeRole(data.role) || state.role;
    if (loadedRole !== state.role) {
      state.role = loadedRole;
      safeSet("mc_role", state.role);
      renderSkeleton();
    } else {
      state.role = loadedRole;
    }
    state.data = normalizeData(data);
    resetPaginationAfterBootstrap();
    if (state.selectedOrderId) await loadChatMessages(state.selectedOrderId);
  } catch (error) {
    showToast("API ошибка: " + error.message);
    state.apiReady = false;
    state.data = emptyData();
  }
  renderAll();
}

function resetPaginationAfterBootstrap() {
  var ordersLength = Array.isArray(state.data.orders) ? state.data.orders.length : 0;
  if (state.role === "executor") {
    state.pagination.openOrders.offset = ordersLength;
    state.pagination.openOrders.hasMore = ordersLength >= state.pagination.openOrders.limit;
  } else {
    state.pagination.customerOrders.offset = ordersLength;
    state.pagination.customerOrders.hasMore = ordersLength >= state.pagination.customerOrders.limit;
  }
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
  $$(".view").forEach(function (section) { section.classList.remove("active"); });
  $("#homeView").classList.add("active");
  $("#homeGrid").innerHTML = "";
  if ($("#bottomNav")) $("#bottomNav").innerHTML = "";
}

function renderSkeleton() {
  $("#welcomeTitle").textContent = state.role === "executor" ? "Кабинет исполнителя" : "Кабинет заказчика";
  $("#rolePill").textContent = state.role === "executor" ? "Исполнитель" : "Заказчик";
  renderUserAvatar();
  renderTabs();
}

function renderTabs() {
  if (!isAllowedView(state.view)) state.view = "homeView";
  var nav = $("#bottomNav");
  if (!nav) return;
  var items = bottomNavItems();
  nav.innerHTML = items.map(function (item) {
    return '<button class="nav-item ' + (state.view === item[0] ? "active" : "") + '" data-go="' + h(item[0]) + '" type="button"><span>' + h(item[2]) + '</span><b>' + h(item[1]) + '</b></button>';
  }).join("");
}

function setView(view) {
  if (!isAllowedView(view)) view = "homeView";
  state.view = view;
  safeSet("mc_view", view);
  $$(".view").forEach(function (section) {
    section.classList.toggle("active", section.id === view);
  });
  renderTabs();
  renderBackButtons();
  renderCurrentView();
  updatePollingState();
}

function isAllowedView(view) {
  return (roleTabs[state.role] || []).some(function (item) { return item[0] === view; });
}

function bottomNavItems() {
  if (state.role === "executor") {
    return [
      ["dashboardView", "Главная", "⌂"],
      ["marketView", "Заказы", "⌕"],
      ["ordersView", "Заявки", "□"],
      ["chatView", "Чат", "◌"],
      ["homeView", "Еще", "≡"]
    ];
  }
  if (state.role === "customer") {
    return [
      ["dashboardView", "Главная", "⌂"],
      ["builderView", "Заказ", "+"],
      ["ordersView", "Мои", "□"],
      ["offersView", "Отклики", "◌"],
      ["homeView", "Еще", "≡"]
    ];
  }
  return [];
}

function renderAll() {
  renderHome();
  renderDashboard();
  setView(state.view || "homeView");
}

function renderCurrentView() {
  if (state.view === "homeView") renderHome();
  if (state.view === "dashboardView") renderDashboard();
  if (state.view === "builderView") updatePreview();
  if (state.view === "ordersView") renderOrders();
  if (state.view === "marketView") renderMarket();
  if (state.view === "favoritesView") renderFavorites();
  if (state.view === "offersView") renderOffers();
  if (state.view === "chatView") renderChat();
  if (state.view === "calendarView") renderCalendar();
  if (state.view === "statsView") renderStats();
  if (state.view === "profileView") renderProfile();
}

function renderBackButtons() {
  $$(".back-home-btn").forEach(function (button) { button.remove(); });
  if (state.view === "homeView" || state.view === "dashboardView") return;
  var section = $("#" + state.view);
  if (!section) return;
  var button = document.createElement("button");
  button.className = "ghost back-home-btn";
  button.type = "button";
  button.dataset.go = "homeView";
  button.textContent = "Все разделы";
  section.insertBefore(button, section.firstChild);
}

function renderHome() {
  var isExecutor = state.role === "executor";
  var items = isExecutor ? [
    ["📊", "Главная", "dashboardView"],
    ["🔍", "Поиск заказов", "marketView"],
    ["📄", "Мои предложения", "ordersView"],
    ["📅", "Календарь", "calendarView"],
    ["🔔", "Уведомления", "offersView"],
    ["📈", "Статистика", "statsView"],
    ["💬", "Чат", "chatView"],
    ["👤", "Профиль", "profileView"]
  ] : [
    ["📊", "Главная", "dashboardView"],
    ["➕", "Создать заказ", "builderView"],
    ["📋", "Мои заказы", "ordersView"],
    ["📩", "Предложения", "offersView"],
    ["🔍", "Исполнители", "marketView"],
    ["⭐", "Избранное", "favoritesView"],
    ["💬", "Чат", "chatView"],
    ["👤", "Профиль", "profileView"]
  ];
  $("#homeGrid").innerHTML = '<div class="home-intro"><p class="eyebrow">Разделы</p><h2>Все инструменты</h2></div>' + items.map(function (item) {
    return '<button class="home-tile" data-go="' + h(item[2]) + '" type="button"><span>' + h(item[0]) + '</span><b>' + h(item[1]) + '</b></button>';
  }).join("");
}

function renderDashboard() {
  var isExecutor = state.role === "executor";
  $("#welcomeTitle").textContent = isExecutor ? "Кабинет исполнителя" : "Кабинет заказчика";
  $("#rolePill").textContent = isExecutor ? "Исполнитель" : "Заказчик";
  $("#roleEyebrow").textContent = isExecutor ? "Производство" : "Заказчик";
  var name = greetingName();
  $("#heroTitle").textContent = "Добрый день" + (name ? ", " + name : "") + "!";
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
    ["Рейтинг", d.rating ? d.rating + " ★" : "0 ★", executorLevel(d.completed_orders || (d.stats && d.stats.completed_orders) || 0)]
  ] : [
    ["Активных заказов", number(d.active_orders_count), "open / in_progress"],
    ["Новых предложений", number(d.pending_offers_count), "pending"],
    ["Исполнителей в избранном", number(d.favorites_count), "ваш список"]
  ];
  $("#dashboardMetrics").innerHTML = metrics.map(metricCard).join("");
  renderBars();
  renderFeed();
}

function renderUserAvatar() {
  var box = $("#userAvatar");
  if (!box) return;
  var initials = (greetingName() || (state.data.profile && state.data.profile.company) || "MC").slice(0, 2).toUpperCase();
  box.innerHTML = state.user.photo_url
    ? '<img src="' + h(state.user.photo_url) + '" alt="">'
    : '<span>' + h(initials) + '</span>';
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
  var items = (state.data.notifications && state.data.notifications.length) ? state.data.notifications : activityEvents();
  if (!items || !items.length) {
    $("#profileFill").textContent = state.apiReady ? "Нет новых событий" : "API не подключен";
    $("#todayFeed").innerHTML = emptyInline("Событий пока нет.");
    return;
  }
  $("#profileFill").textContent = items.length + " событий";
  $("#todayFeed").innerHTML = items.slice(0, 5).map(function (item) {
    return '<button class="event as-button" data-go="' + h(item.view || "ordersView") + '" type="button"><i>🔔</i><p>' + h(item.text) + '</p></button>';
  }).join("");
}

function activityEvents() {
  var events = [];
  (state.data.orders || []).slice(0, 3).forEach(function (order) {
    events.push({ view: "ordersView", text: "Создан заказ #" + order.id + " «" + (order.title || "Заказ") + "»" });
  });
  (state.data.offers || []).slice(0, 3).forEach(function (offer) {
    events.push({ view: "offersView", text: "Получено предложение по заказу #" + offer.order_id });
  });
  (state.data.favorites || []).slice(0, 2).forEach(function (executor) {
    events.push({ view: "favoritesView", text: "В избранном: " + (executor.company || "Исполнитель") });
  });
  return events.slice(0, 5);
}

function updatePreview() {
  state.material = currentMaterial();
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

function currentMaterial() {
  return ($("#orderMaterial") && $("#orderMaterial").value) || state.material || "Сталь";
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
    material: currentMaterial(),
    quantity: Number($("#orderQty").value || 0),
    budget: $("#negotiableBudget").checked ? "Договорной" : buildBudget(),
    city: $("#orderCity").value.trim(),
    deadline: $("#orderDeadline").value,
    payment_terms: $("#orderPayment").value
  };
}

async function publishOrder() {
  if (state.role !== "customer") {
    showToast("Создавать заказы может только заказчик.");
    setView("dashboardView");
    return;
  }
  var payload = orderPayload();
  var button = $("#publishOrderBtn");
  if (!payload.title || !payload.description || !payload.quantity || !payload.budget || !payload.city || !payload.deadline) {
    showToast("Заполните название, описание, количество, город, срок и бюджет.");
    return;
  }
  if ($("#orderFiles").files && $("#orderFiles").files.length > 5) {
    showToast("Можно приложить до 5 файлов.");
    return;
  }
  try {
    setButtonLoading(button, true, "Публикую...");
    if ($("#orderFiles").files && $("#orderFiles").files[0]) {
      payload.file_id = await imageFileToDataUrl($("#orderFiles").files[0], 1280, 0.72);
      payload.file_type = "image_data";
    }
    if (API_BASE) await apiPost("/api/orders/create", payload);
    else if (tg && tg.sendData) tg.sendData(JSON.stringify(payload));
    showToast("Заказ отправлен.");
    clearOrderForm();
    await refreshAfterOrderCreate();
    setView("ordersView");
  } catch (error) {
    showToast("Не удалось отправить заказ: " + error.message);
  } finally {
    setButtonLoading(button, false);
  }
}

function renderOrders() {
  var isExecutor = state.role === "executor";
  var allowedTabs = isExecutor ? ["pending", "accepted", "declined"] : ["open", "in_progress", "completed", "cancelled"];
  if (allowedTabs.indexOf(state.orderTab) === -1) state.orderTab = allowedTabs[0];
  $("#ordersTitle").textContent = isExecutor ? "Мои предложения" : "Мои заказы";
  var newOrderButton = $('#ordersView [data-go="builderView"]');
  if (newOrderButton) newOrderButton.style.display = isExecutor ? "none" : "";
  var tabs = isExecutor
    ? [["pending", "⏳ Ожидает"], ["accepted", "✅ Принято"], ["declined", "❌ Отклонено"]]
    : [["open", "🟢 Активные"], ["in_progress", "🟡 В работе"], ["completed", "✅ Выполненные"], ["cancelled", "⚪ Отмененные"]];
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
  var html = filtered.map(isExecutor ? offerRow : orderRow).join("") ||
    emptyPanel(isExecutor ? "Предложений пока нет" : "Заказов пока нет", isExecutor ? "Откройте поиск заказов и отправьте первое предложение." : "Создайте первый заказ, чтобы получать предложения.");
  if (!isExecutor && state.pagination.customerOrders.hasMore) {
    html += '<div class="pager"><button class="ghost" data-action="load-more-orders" type="button">Загрузить еще 20</button></div>';
  }
  $("#ordersList").innerHTML = html;
}

function orderRow(order) {
  var orderOffers = (state.data.offers || []).filter(function (offer) { return String(offer.order_id) === String(order.id); });
  var offersPreview = orderOffers.length
    ? '<div class="tags">' + orderOffers.slice(0, 3).map(function (offer) {
        return '<span class="tag">' + h(offer.executor_company || "Исполнитель") + ': ' + h(offer.price || "цена не указана") + '</span>';
      }).join("") + '</div>'
    : "";
  var canChat = order.executor_id || order.selected_executor_id || order.status === "in_progress" || order.status === "completed";
  var chatButton = '<button class="ghost" data-action="' + (canChat ? "select-chat" : "chat-unavailable") + '" data-order="' + h(order.id) + '" type="button">💬 Чат</button>';
  var editButton = order.status === "open" ? '<button class="ghost" data-action="edit-order" data-order="' + h(order.id) + '" type="button">Редактировать</button>' : "";
  var cancelButton = order.status === "open" || order.status === "in_progress" ? '<button class="ghost" data-action="cancel-order" data-order="' + h(order.id) + '" type="button">Отменить</button>' : "";
  var completeButton = order.status === "in_progress" ? '<button class="ghost" data-action="complete-order" data-order="' + h(order.id) + '" type="button">Завершить</button>' : "";
  return '<article class="order-card">' +
    drawingPreview(order) +
    '<div class="card-head"><div><h3>#' + h(order.id) + ' ' + h(order.title) + '</h3><p>' + h(order.budget || "бюджет не указан") + ' · срок до ' + h(order.deadline || "не указан") + '</p></div><span class="status ' + statusClass(order.status) + '">' + h(statusLabel(order.status)) + '</span></div>' +
    '<div class="tags"><span class="tag">' + h(order.material || "Материал не указан") + '</span><span class="tag">' + h(order.quantity || 0) + ' шт.</span><span class="tag">Предложений: ' + h(order.offers_count || 0) + '</span></div>' +
    offersPreview +
    '<div class="card-actions"><button class="primary small" data-action="view-offers" data-order="' + h(order.id) + '" type="button">Смотреть предложения</button>' + chatButton + editButton + cancelButton + completeButton + '</div></article>';
}

function offerRow(offer) {
  var chatButton = offer.status === "accepted"
    ? '<button class="ghost" data-action="select-chat" data-order="' + h(offer.order_id) + '" type="button">💬 Написать заказчику</button>'
    : (offer.status === "declined" ? '<button class="primary small" data-action="open-offer" data-order="' + h(offer.order_id) + '" type="button">Сделать новое предложение</button>' : "");
  return '<article class="order-card">' +
    '<div class="card-head"><div><h3>#' + h(offer.order_id) + ' ' + h(offer.order_title || "Заказ") + '</h3><p>' + h(offer.city || "") + ' · ' + h(offer.price || "цена не указана") + '</p></div><span class="status ' + statusClass(offer.status) + '">' + h(offerStatus(offer.status)) + '</span></div>' +
    '<p>' + h(offer.comment || "") + '</p><div class="card-actions">' + chatButton + '</div></article>';
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
  var html = rows.map(function (order) {
    var existingOffer = (state.data.offers || []).find(function (offer) { return String(offer.order_id) === String(order.id); });
    var isPendingOffer = existingOffer && existingOffer.status === "pending";
    var isAcceptedOffer = existingOffer && existingOffer.status === "accepted";
    var offerButton = isPendingOffer
      ? '<button class="ghost" disabled type="button">Предложение отправлено</button>'
      : (isAcceptedOffer
        ? '<button class="ghost" disabled type="button">Предложение принято</button>'
        : '<button class="primary small" data-action="open-offer" data-order="' + h(order.id) + '" type="button">💰 Сделать предложение</button>');
    return '<article class="entity-card order-search-card">' + drawingPreview(order) +
      '<div class="card-head"><div><h3>#' + h(order.id) + ' ' + h(order.title) + '</h3><p>' + h(order.customer_name || "Заказчик") + ' · ' + h(order.city || "") + ' · до ' + h(order.deadline || "") + '</p></div><span class="badge neutral">' + h(order.material || "") + '</span></div>' +
      '<div class="tags"><span class="tag">' + h(order.quantity || 0) + ' шт.</span><span class="tag">срочность: ' + h(order.urgency || "не указана") + '</span><span class="tag">' + h(order.budget || "бюджет не указан") + '</span></div>' +
      '<div class="card-actions">' + offerButton + '</div></article>';
  }).join("") || emptyPanel("Открытых заказов нет", "Подходящих заказов по фильтрам не найдено.");
  if (state.pagination.openOrders.hasMore) {
    html += '<div class="pager"><button class="ghost" data-action="load-more-open-orders" type="button">Загрузить еще 20</button></div>';
  }
  $("#marketCards").innerHTML = html;
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
    return '<article class="entity-card"><div class="card-head">' + avatarHtml(executor) + '<div><h3>' + h(executor.company || "Исполнитель") + '</h3><p>' + h(executor.city || "") + ' · ' + stars(executor.rating || 0) + '</p></div></div>' +
      '<div class="tags"><span class="tag">' + h(executor.specialization || "специализация не указана") + '</span></div>' +
      '<div class="card-actions"><button class="primary small" data-action="favorite" data-executor="' + h(executor.id) + '" type="button">❤️ В избранное</button><button class="ghost" data-action="select-chat-user" data-user="' + h(executor.id) + '" type="button">💬 Написать</button></div></article>';
  }).join("") || emptyPanel("Исполнители не найдены", "Попробуйте изменить фильтры.");
}

function avatarHtml(user) {
  var label = (user.company || user.full_name || "?").slice(0, 2).toUpperCase();
  if (user.photo_url) return '<div class="avatar"><img src="' + h(user.photo_url) + '" alt=""></div>';
  return '<div class="avatar">' + h(label) + '</div>';
}

function stars(value) {
  var rating = Math.round(Number(value || 0));
  return "★".repeat(Math.max(0, Math.min(5, rating))) + "☆".repeat(Math.max(0, 5 - rating));
}

function renderFavorites() {
  var rows = state.data.favorites || [];
  $("#favoritesCount").textContent = rows.length + " сохранено";
  $("#favoritesList").innerHTML = rows.map(function (executor) {
    return '<article class="order-card"><div class="card-head"><div><h3>' + h(executor.company || "Исполнитель") + '</h3><p>' + h(executor.city || "") + ' · ' + h(executor.rating || 0) + ' ★</p></div><button class="ghost" data-action="remove-favorite" data-executor="' + h(executor.id) + '" type="button">Удалить из избранного</button></div>' +
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
  var offers = state.offerFilterOrderId
    ? (state.data.offers || []).filter(function (offer) { return String(offer.order_id) === String(state.offerFilterOrderId); })
    : (state.data.offers || []);
  $("#offersTitle").textContent = state.offerFilterOrderId ? "Предложения по заказу #" + state.offerFilterOrderId : "Предложения от исполнителей";
  $("#offersBadge").textContent = offers.length + " всего";
  $("#offersList").innerHTML = offers.map(function (offer) {
    var actions = offer.status === "pending"
      ? '<button class="primary small" data-action="accept-offer" data-offer="' + h(offer.id) + '" type="button">✅ Принять</button><button class="ghost" data-action="decline-offer" data-offer="' + h(offer.id) + '" type="button">❌ Отклонить</button>'
      : (offer.status === "accepted" ? '<button class="ghost" data-action="select-chat" data-order="' + h(offer.order_id) + '" type="button">💬 Чат</button>' : "");
    return '<article class="order-card"><div class="card-head"><div><h3>Заказ #' + h(offer.order_id) + ' ' + h(offer.order_title || "") + '</h3><p>' + h(offer.executor_company || "Исполнитель") + ' · ' + h(offer.deadline || "срок не указан") + '</p></div><strong>' + h(offer.price || "") + '</strong></div><div class="tags"><span class="status ' + statusClass(offer.status) + '">' + h(offerStatus(offer.status)) + '</span></div><p>' + h(offer.comment || "") + '</p><div class="card-actions">' + actions + '</div></article>';
  }).join("") || emptyPanel("Предложений пока нет", "Когда исполнители откликнутся, они появятся здесь.");
}

function renderChat() {
  renderChatOrderSelect();
  var order = findOrder(state.selectedOrderId);
  var acceptedExecutor = String(order && (order.executor_id || order.selected_executor_id || "")) === String(state.user.id);
  var acceptedOffer = order && order.offer_status === "accepted";
  var chatReady = !!order && (state.role === "executor" ? (acceptedExecutor || acceptedOffer) : (order.executor_id || order.selected_executor_id || order.status === "in_progress"));
  $("#chatOrderId").textContent = order ? "#" + order.id : "Заказ";
  $("#chatOrderTitle").textContent = order ? order.title : "Не выбран";
  $("#chatOrderMeta").textContent = order ? [order.city, order.quantity ? order.quantity + " шт." : "", order.budget].filter(Boolean).join(" · ") : "Откройте чат из карточки заказа";
  $("#chatTitle").textContent = order ? "Чат по заказу #" + order.id : "Чат по заказу";
  $("#chatMeta").textContent = order ? "История сообщений по выбранному заказу." : "Сообщения загружаются только по конкретному заказу.";
  $("#chatInput").disabled = !chatReady;
  $("#chatInput").placeholder = order ? (chatReady ? "Написать сообщение" : "Чат откроется после принятия предложения") : "Сначала выберите заказ";
  $("#chatForm button").disabled = !chatReady;
  var messages = state.selectedOrderId ? (state.data.messages || []).filter(function (message) { return String(message.order_id) === String(state.selectedOrderId); }) : [];
  $("#messages").innerHTML = messages.map(function (message) {
    var me = String(message.from_user_id || message.sender_id) === String(state.user.id);
    var file = message.file_id ? messagePreview(message.file_id, message.file_type) : "";
    return '<div class="bubble ' + (me ? "me" : "") + '">' + file + (message.text ? '<p>' + h(message.text) + '</p>' : "") + '</div>';
  }).join("") || emptyPanel("Сообщений нет", chatReady ? "Напишите первое сообщение по заказу." : (order ? "Чат откроется после принятия предложения." : "Сначала выберите заказ."));
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

function renderChatOrderSelect() {
  var select = $("#chatOrderSelect");
  if (!select) return;
  var rows = chatOrders();
  if (!state.selectedOrderId && rows.length) state.selectedOrderId = rows[0].id;
  select.innerHTML = '<option value="">Выберите заказ</option>' + rows.map(function (order) {
    return '<option value="' + h(order.id) + '">#' + h(order.id) + ' ' + h(order.title || "Заказ") + '</option>';
  }).join("");
  select.value = state.selectedOrderId || "";
}

async function selectChatOrder() {
  state.selectedOrderId = $("#chatOrderSelect").value || null;
  state.data.messages = [];
  if (state.selectedOrderId) await loadChatMessages(state.selectedOrderId);
  renderChat();
  updatePollingState();
}

function chatOrders() {
  if (state.role === "executor") {
    return (state.data.offers || []).filter(function (offer) {
      return offer.status === "accepted";
    }).map(function (offer) {
      return findOrder(offer.order_id) || {
        id: offer.order_id,
        title: offer.order_title || "Заказ",
        city: offer.city || "",
        budget: offer.budget || offer.price || "",
        offer_status: offer.status
      };
    });
  }
  return (state.data.orders || []).filter(function (order) {
    return order.executor_id || order.selected_executor_id || order.status === "in_progress" || order.status === "completed";
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
  if ($("#portfolioPanel")) $("#portfolioPanel").hidden = state.role !== "executor";
  if ($("#portfolioGrid")) $("#portfolioGrid").hidden = state.role !== "executor";
  if ($("#reviewsList")) $("#reviewsList").hidden = state.role !== "executor";
  if (state.role !== "executor") return;
  var rows = state.data.portfolio || [];
  $("#portfolioGrid").innerHTML = rows.map(function (item) {
    var preview = item.file_id && String(item.file_id).indexOf("data:image/") === 0
      ? '<img src="' + h(item.file_id) + '" alt="">'
      : '<span>' + h(item.file_id || "Фото") + '</span>';
    return '<article class="portfolio-card steel"><div>' + preview + '</div><h3>' + h(item.title || "Работа") + '</h3><p>' + h(item.description || "") + '</p><small>' + h(item.equipment || "") + '</small><button class="ghost" data-action="remove-portfolio" data-item="' + h(item.id) + '" type="button">Удалить</button></article>';
  }).join("") || emptyPanel("Портфолио пустое", "Добавьте фото работ, описание оборудования и станков.");
  $("#reviewsList").innerHTML = (state.data.reviews || []).map(function (review) {
    return '<article class="order-card"><div class="card-head"><h3>' + h(review.author_company || review.author_name || "Заказчик") + '</h3><span class="status done">' + h(review.stars || 0) + ' ★</span></div><p>' + h(review.text || "") + '</p></article>';
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
    ? [["Название компании", "company", p.company], ["Город", "city", p.city], ["Специализация", "specialization", p.specialization], ["Телефон", "phone", p.phone], ["График работы", "work_status", p.work_status], ["Описание", "description", p.description], ["Email", "email", p.email], ["Рейтинг", "rating", (p.rating || 0) + " ★"]]
    : [["Компания", "company", p.company], ["Город", "city", p.city], ["Телефон", "phone", p.phone], ["Тип", "customer_type", p.customer_type || (p.company ? "Юрлицо" : "Физлицо")]];
  var progress = profileProgress(rows);
  $("#profileCard").innerHTML = '<div class="profile-progress"><div><b>Заполненность профиля</b><span>' + progress + '%</span></div><i><em style="width:' + progress + '%"></em></i></div>' +
    '<h3>' + (state.role === "executor" ? "Данные компании" : "Данные заказчика") + '</h3>' + rows.map(function (row) {
    var readonly = row[1] === "rating" ? " readonly" : "";
    return '<label>' + h(row[0]) + '<input data-profile="' + h(row[1]) + '" value="' + h(row[2] || "") + '"' + readonly + '></label>';
  }).join("") + '<button class="primary" data-action="save-profile" type="button">Сохранить профиль</button>';
  renderPortfolio();
}

function profileProgress(rows) {
  var editable = rows.filter(function (row) { return row[1] !== "rating"; });
  var filled = editable.filter(function (row) { return String(row[2] || "").trim(); }).length;
  return editable.length ? Math.round(filled / editable.length * 100) : 0;
}

function openOffer(orderId) {
  if (state.role !== "executor") {
    showToast("Предложения может отправлять только исполнитель.");
    return;
  }
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
  var button = event.submitter;
  if (event.submitter && event.submitter.value === "cancel") {
    closeOfferModal();
    return;
  }
  if (!$("#offerPrice").value || !$("#offerComment").value.trim()) {
    showToast("Заполните цену и комментарий.");
    return;
  }
  try {
    setButtonLoading(button, true, "Отправляю...");
    await apiPost("/api/offers/create", {
      order_id: state.selectedOrderId,
      price: $("#offerPrice").value,
      deadline_days: $("#offerDays").value,
      comment: $("#offerComment").value.trim()
    });
    closeOfferModal();
    showToast("Предложение отправлено.");
    await refreshExecutorDataAfterOffer();
  } catch (error) {
    showToast("Не удалось отправить предложение: " + error.message);
  } finally {
    setButtonLoading(button, false);
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
  ["orderTitle", "orderCity", "orderDescription", "orderMaterial", "orderQty", "orderDeadline", "budgetFrom", "budgetTo", "negotiableBudget", "orderPayment", "orderFiles"].forEach(function (id) {
    $("#" + id).addEventListener("input", updatePreview);
    $("#" + id).addEventListener("change", updatePreview);
  });
  $("#chatOrderSelect").addEventListener("change", selectChatOrder);
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
  $("#chatForm").addEventListener("submit", sendChatMessage);
  $("#chatPhoto").addEventListener("change", uploadChatPhoto);
  $("#attachBtn").addEventListener("click", function () {
    if (!state.selectedOrderId) {
      showToast("Сначала выберите заказ для чата.");
      return;
    }
    $("#chatPhoto").click();
  });
  $("#manualApiSaveBtn").addEventListener("click", function () {
    setApiUrl($("#manualApiUrl").value);
  });
  initSettings();
  document.addEventListener("change", function (event) {
    if (event.target && event.target.matches("[data-setting]")) saveSetting(event.target);
  });
  document.addEventListener("click", handleActionClick);
  updateApiTools();
  startPolling();
}

async function sendChatMessage(event) {
  event.preventDefault();
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
    scrollMessagesToBottom();
  } catch (error) {
    showToast("Не удалось отправить сообщение: " + error.message);
  }
}

async function handleActionClick(event) {
  var button = event.target.closest("[data-go], [data-action]");
  if (!button) return;
  if (button.dataset.go) {
    if (button.dataset.go === "offersView") state.offerFilterOrderId = null;
    setView(button.dataset.go);
    return;
  }
  var action = button.dataset.action;
  if (action === "open-offer") openOffer(button.dataset.order);
  if (action === "chat-unavailable") {
    state.selectedOrderId = button.dataset.order;
    showToast("Чат откроется после принятия предложения по этому заказу.");
    setView("chatView");
    return;
  }
  if (action === "select-chat-user") {
    await openExecutorChatOrOrder(button.dataset.user);
    return;
  }
  if (action === "select-chat" || action === "view-offers") {
    state.selectedOrderId = button.dataset.order;
    if (action === "view-offers") state.offerFilterOrderId = button.dataset.order;
    if (action === "view-offers" && state.role === "customer") await refreshCustomerOffers();
    if (action === "select-chat") await loadChatMessages(state.selectedOrderId);
    setView(action === "view-offers" ? "offersView" : "chatView");
  }
  if (action === "complete-order") await completeOrder(button.dataset.order);
  if (action === "edit-order") await editOrder(button.dataset.order);
  if (action === "cancel-order") await actionPost("/api/orders/cancel", { order_id: button.dataset.order });
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
  if (action === "load-more-orders") await loadMoreCustomerOrders(button);
  if (action === "load-more-open-orders") await loadMoreOpenOrders(button);
}

async function addPortfolio() {
  var button = $("#portfolioAddBtn");
  var fileId = $("#portfolioFileId").value.trim();
  var text = $("#portfolioText").value.trim();
  var fileInput = $("#portfolioPhoto");
  var equipment = $("#portfolioEquipment") ? $("#portfolioEquipment").value.trim() : "";
  if (!text) {
    showToast("Заполните описание работы, оборудование или станок.");
    return;
  }
  if (!fileId && fileInput && fileInput.files && fileInput.files[0]) {
    fileId = await imageFileToDataUrl(fileInput.files[0], 1280, 0.72);
  }
  if (!fileId) {
    showToast("Добавьте фото или укажите file_id.");
    return;
  }
  try {
    setButtonLoading(button, true, "Добавляю...");
    await actionPost("/api/portfolio/add", { file_id: fileId, description: text, text: text, equipment: equipment, file_type: fileId.indexOf("data:image/") === 0 ? "image_data" : "photo" });
    $("#portfolioFileId").value = "";
    $("#portfolioText").value = "";
    if ($("#portfolioEquipment")) $("#portfolioEquipment").value = "";
    if (fileInput) fileInput.value = "";
  } finally {
    setButtonLoading(button, false);
  }
}

async function actionPost(path, body) {
  var activeButton = document.activeElement && document.activeElement.tagName === "BUTTON" ? document.activeElement : null;
  try {
    setButtonLoading(activeButton, true);
    var data = await apiPost(path, body);
    await refreshAfterMutation(path);
    return data;
  } catch (error) {
    showToast("Действие не выполнено: " + error.message);
    return null;
  } finally {
    setButtonLoading(activeButton, false);
  }
}

async function actionDelete(path) {
  var activeButton = document.activeElement && document.activeElement.tagName === "BUTTON" ? document.activeElement : null;
  try {
    setButtonLoading(activeButton, true);
    await apiDelete(path);
    await refreshAfterMutation(path);
  } catch (error) {
    showToast("Действие не выполнено: " + error.message);
  } finally {
    setButtonLoading(activeButton, false);
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

async function openExecutorChatOrOrder(executorId) {
  var order = (state.data.orders || []).find(function (item) {
    return String(item.executor_id || item.selected_executor_id || "") === String(executorId) && item.status === "in_progress";
  });
  if (order) {
    state.selectedOrderId = order.id;
    await loadChatMessages(order.id);
    setView("chatView");
    return;
  }
  showToast("Чат доступен после принятия предложения.");
  setView("builderView");
}

async function completeOrder(orderId) {
  var data = await actionPost("/api/orders/complete", { order_id: orderId });
  if (!data || !data.ok) return;
  var starsValue = window.prompt("Оцените исполнителя от 1 до 5", "5");
  if (starsValue === null) return;
  var starsCount = Math.max(1, Math.min(5, Number(starsValue || 5)));
  var text = window.prompt("Короткий отзыв об исполнителе", "");
  await actionPost("/api/reviews/add", { order_id: orderId, stars: starsCount, text: text || "" });
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
  try {
    state.data.stats = await apiGet("/api/stats/executor?period=" + encodeURIComponent(state.statsPeriod));
    renderStats();
  } catch (error) {
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

function drawingPreview(order) {
  var fileId = order.file_id || order.photo_id || order.file_preview || "";
  if (order.file_url) return '<div class="drawing-preview">' + filePreview(API_BASE + order.file_url + withUserId("").replace("?", "&"), order.file_type, true) + '</div>';
  if (!fileId) return '<div class="drawing-preview"><span>' + h(order.has_file ? "чертеж прикреплен" : "чертеж не прикреплен") + '</span></div>';
  return '<div class="drawing-preview">' + filePreview(fileId, order.file_type, false) + '</div>';
}

function filePreview(fileId, fileType, forceImage) {
  if (forceImage || String(fileId).indexOf("data:image/") === 0) {
    return '<img src="' + h(fileId) + '" alt="Прикрепленный файл">';
  }
  return '<span>' + h(fileId) + '</span>';
}

function messagePreview(fileId, fileType) {
  return '<div class="message-file">' + filePreview(fileId, fileType) + '</div>';
}

function readFileAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function imageFileToDataUrl(file, maxSide, quality) {
  if (!file || !file.type || file.type.indexOf("image/") !== 0) return readFileAsDataUrl(file);
  var source = await readFileAsDataUrl(file);
  return new Promise(function (resolve) {
    var image = new Image();
    image.onload = function () {
      var scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      var width = Math.max(1, Math.round(image.width * scale));
      var height = Math.max(1, Math.round(image.height * scale));
      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality || 0.72));
    };
    image.onerror = function () { resolve(source); };
    image.src = source;
  });
}

function setButtonLoading(button, loading, label) {
  if (!button) return;
  if (loading) {
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.classList.add("is-loading");
    button.textContent = label || "Загрузка...";
    return;
  }
  button.disabled = false;
  button.classList.remove("is-loading");
  if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

async function refreshAfterOrderCreate() {
  await refreshCustomerOrders();
}

async function refreshCustomerOrders() {
  if (state.role !== "customer") {
    await loadData();
    return;
  }
  var results = await Promise.all([
    apiGet("/api/orders/customer?limit=" + state.pagination.customerOrders.limit + "&offset=0"),
    apiGet("/api/offers/customer"),
    apiGet("/api/dashboard/customer")
  ]);
  var orders = results[0];
  var offers = results[1];
  var dashboard = results[2];
  state.data.orders = (orders.orders || []).map(function (item) {
    item.status = normalizeStatus(item.status);
    return item;
  });
  state.data.offers = (offers.offers || []).map(function (item) {
    item.status = normalizeStatus(item.status);
    return item;
  });
  state.pagination.customerOrders.offset = state.data.orders.length;
  state.pagination.customerOrders.hasMore = !!orders.has_more;
  state.data.dashboard = dashboard || {};
  state.data.week = dashboard.week || state.data.week;
  renderDashboard();
  renderOrders();
}

async function refreshCustomerOffers() {
  if (state.role !== "customer") return;
  var offers = await apiGet("/api/offers/customer");
  state.data.offers = (offers.offers || []).map(function (item) {
    item.status = normalizeStatus(item.status);
    return item;
  });
}

async function refreshAfterMutation(path) {
  if (path.indexOf("/api/calendar") === 0) {
    var calendarData = await apiGet("/api/calendar");
    state.data.calendar = calendarData.calendar || {};
    renderCalendar();
    return;
  }
  if (path.indexOf("/api/portfolio") === 0) {
    var portfolioData = await apiGet("/api/portfolio");
    state.data.portfolio = portfolioData.portfolio || [];
    renderPortfolio();
    return;
  }
  if (path.indexOf("/api/reviews") === 0) {
    showToast("Отзыв сохранен.");
    return;
  }
  if (path.indexOf("/api/favorites") === 0) {
    if (state.role === "customer") {
      var favoritesData = await apiGet("/api/favorites");
      state.data.favorites = favoritesData.favorites || [];
      renderFavorites();
      renderMarket();
    }
    return;
  }
  if (path.indexOf("/api/profile") === 0) {
    var me = await apiGet("/api/me");
    state.data.profile = me.user || {};
    renderProfile();
    return;
  }
  if (path.indexOf("/api/orders") === 0 && state.role === "customer") {
    await refreshCustomerOrders();
    return;
  }
  if (path.indexOf("/api/offers") === 0) {
    if (state.role === "customer") {
      await refreshCustomerOrders();
      renderOffers();
      return;
    }
    await refreshExecutorDataAfterOffer();
    return;
  }
  await loadData();
}

async function refreshExecutorDataAfterOffer() {
  if (state.role !== "executor") {
    await loadData();
    return;
  }
  var results = await Promise.all([
    apiGet("/api/offers/executor"),
    apiGet("/api/orders/open?limit=" + state.pagination.openOrders.limit + "&offset=0")
  ]);
  var offers = results[0];
  var orders = results[1];
  state.data.offers = (offers.offers || []).map(function (item) {
    item.status = normalizeStatus(item.status);
    return item;
  });
  state.data.orders = (orders.orders || []).map(function (item) {
    item.status = normalizeStatus(item.status);
    return item;
  });
  state.pagination.openOrders.offset = state.data.orders.length;
  state.pagination.openOrders.hasMore = !!orders.has_more;
  renderOrders();
  renderMarket();
}

async function loadMoreCustomerOrders(button) {
  var page = state.pagination.customerOrders;
  if (page.loading || !page.hasMore) return;
  try {
    page.loading = true;
    setButtonLoading(button, true, "Загружаю...");
    var data = await apiGet("/api/orders/customer?limit=" + page.limit + "&offset=" + page.offset);
    var rows = (data.orders || []).map(function (item) {
      item.status = normalizeStatus(item.status);
      return item;
    });
    state.data.orders = appendUniqueById(state.data.orders, rows);
    page.offset += rows.length;
    page.hasMore = !!data.has_more;
    renderOrders();
  } catch (error) {
    showToast("Не удалось загрузить заказы: " + error.message);
  } finally {
    page.loading = false;
    setButtonLoading(button, false);
  }
}

async function loadMoreOpenOrders(button) {
  var page = state.pagination.openOrders;
  if (page.loading || !page.hasMore) return;
  try {
    page.loading = true;
    setButtonLoading(button, true, "Загружаю...");
    var data = await apiGet("/api/orders/open?limit=" + page.limit + "&offset=" + page.offset);
    var rows = (data.orders || []).map(function (item) {
      item.status = normalizeStatus(item.status);
      return item;
    });
    state.data.orders = appendUniqueById(state.data.orders, rows);
    page.offset += rows.length;
    page.hasMore = !!data.has_more;
    renderMarket();
  } catch (error) {
    showToast("Не удалось загрузить заказы: " + error.message);
  } finally {
    page.loading = false;
    setButtonLoading(button, false);
  }
}

function appendUniqueById(current, incoming) {
  var seen = {};
  var result = [];
  (current || []).forEach(function (item) {
    seen[String(item.id)] = true;
    result.push(item);
  });
  (incoming || []).forEach(function (item) {
    var key = String(item.id);
    if (seen[key]) return;
    seen[key] = true;
    result.push(item);
  });
  return result;
}

async function uploadChatPhoto() {
  var input = $("#chatPhoto");
  var file = input.files && input.files[0];
  if (!file || !state.selectedOrderId) return;
  try {
    setButtonLoading($("#attachBtn"), true, "Отправляю...");
    var fileId = await imageFileToDataUrl(file, 1280, 0.72);
    await apiPost("/api/chat/upload", {
      order_id: state.selectedOrderId,
      text: file.name,
      file_id: fileId,
      file_type: "image_data"
    });
    input.value = "";
    await loadChatMessages(state.selectedOrderId);
    renderChat();
    scrollMessagesToBottom();
  } catch (error) {
    showToast("Не удалось отправить фото: " + error.message);
  } finally {
    setButtonLoading($("#attachBtn"), false);
  }
}

async function editOrder(orderId) {
  var order = findOrder(orderId);
  if (!order) return;
  var title = window.prompt("Название заказа", order.title || "");
  if (title === null) return;
  var description = window.prompt("Описание", order.description || "");
  if (description === null) return;
  var budget = window.prompt("Бюджет", order.budget || "");
  if (budget === null) return;
  await actionPost("/api/orders/update", {
    order_id: orderId,
    title: title.trim(),
    description: description.trim(),
    budget: budget.trim()
  });
}

async function saveProfile() {
  var button = document.activeElement && document.activeElement.tagName === "BUTTON" ? document.activeElement : null;
  var payload = {};
  $$("[data-profile]").forEach(function (input) {
    payload[input.dataset.profile] = input.value.trim();
  });
  payload.role = state.role;
  delete payload.rating;
  try {
    setButtonLoading(button, true, "Сохраняю...");
    var data = await apiPost("/api/profile/update", payload);
    state.data.profile = data.profile || Object.assign({}, state.data.profile || {}, payload);
    renderProfile();
    showToast("Профиль сохранен.");
  } catch (error) {
    showToast("Не удалось сохранить профиль: " + error.message);
  } finally {
    setButtonLoading(button, false);
  }
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
    budget: offer.budget || offer.price || "",
    offer_status: offer.status
  };
}

async function loadChatMessages(orderId) {
  if (!orderId) return;
  try {
    var data = await apiGet("/api/chat/messages?order_id=" + encodeURIComponent(orderId));
    state.data.messages = data.messages || [];
  } catch (error) {
    showToast("Не удалось загрузить чат: " + error.message);
  }
}

function startPolling() {
  if (!state.livePollTimer) {
    state.livePollTimer = window.setInterval(pollLiveData, 4000);
  }
  updatePollingState();
}

function updatePollingState() {
  var shouldPollChat = !!(API_BASE && state.apiReady && state.view === "chatView" && state.selectedOrderId);
  if (shouldPollChat && !state.chatPollTimer) {
    state.chatPollTimer = window.setInterval(pollChatMessages, 4000);
    pollChatMessages();
    return;
  }
  if (!shouldPollChat && state.chatPollTimer) {
    window.clearInterval(state.chatPollTimer);
    state.chatPollTimer = null;
  }
}

async function pollChatMessages() {
  if (!API_BASE || !state.apiReady || !state.selectedOrderId || state.view !== "chatView" || state.chatPollBusy) {
    updatePollingState();
    return;
  }
  state.chatPollBusy = true;
  try {
    var data = await apiGet("/api/chat/messages?order_id=" + encodeURIComponent(state.selectedOrderId));
    var nextMessages = data.messages || [];
    if (messagesChanged(state.data.messages || [], nextMessages)) {
      state.data.messages = nextMessages;
      renderChat();
      scrollMessagesToBottom();
    }
  } catch (error) {
  } finally {
    state.chatPollBusy = false;
  }
}

async function pollLiveData() {
  if (!API_BASE || !state.apiReady || state.pollBusy) return;
  var liveViews = ["dashboardView", "ordersView", "offersView", "marketView"];
  if (liveViews.indexOf(state.view) === -1) return;
  state.pollBusy = true;
  try {
    if (state.role === "customer") {
      await refreshCustomerOrders();
      if (state.view === "offersView") renderOffers();
      return;
    }
    if (state.role === "executor" && (state.view === "marketView" || state.view === "ordersView")) {
      await refreshExecutorDataAfterOffer();
    }
  } catch (error) {
  } finally {
    state.pollBusy = false;
  }
}

function messagesChanged(current, next) {
  if (current.length !== next.length) return true;
  var currentLast = current[current.length - 1] || {};
  var nextLast = next[next.length - 1] || {};
  return String(currentLast.id || "") !== String(nextLast.id || "");
}

function scrollMessagesToBottom() {
  var box = $("#messages");
  if (box) box.scrollTop = box.scrollHeight;
}

function updateApiTools() {
  var panel = $("#apiMissingPanel");
  var input = $("#manualApiUrl");
  if (panel) panel.hidden = !!API_BASE;
  if (input && !input.value) input.value = API_BASE || "";
}

function settingStorageKey(name) {
  return "mc_setting_" + (state.user.id || explicitUserId || "anon") + "_" + name;
}

function initSettings() {
  $$("[data-setting]").forEach(function (control) {
    var saved = safeGet(settingStorageKey(control.dataset.setting), "");
    if (!saved) return;
    if (control.type === "checkbox") control.checked = saved === "1";
    else control.value = saved;
  });
}

function saveSetting(control) {
  var value = control.type === "checkbox" ? (control.checked ? "1" : "0") : control.value;
  safeSet(settingStorageKey(control.dataset.setting), value);
}

function statusLabel(status) {
  var labels = { open: "Открыт", in_progress: "В работе", completed: "Выполнен", cancelled: "Отменен", pending: "Ожидает", accepted: "Принято", declined: "Отклонено" };
  return labels[status] || status || "Не указан";
}

function normalizeStatus(status) {
  var map = { new: "open", work: "in_progress", done: "completed", cancelled: "cancelled" };
  return map[status] || status || "";
}

function offerStatus(status) {
  return statusLabel(status);
}

function statusClass(status) {
  if (status === "completed" || status === "accepted") return "done";
  if (status === "in_progress" || status === "pending") return "warn";
  if (status === "declined") return "bad";
  if (status === "cancelled") return "muted";
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
  if (tg && tg.showPopup) tg.showPopup({ message: message });
  else window.alert(message);
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

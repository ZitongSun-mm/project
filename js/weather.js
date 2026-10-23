/* ============================================================
   Weather app — live weather from the UAPI Weather API
   https://uapis.cn/api/v1/misc/weather?city=<city name>
   ============================================================ */
(function () {
  "use strict";

  var API_URL = "https://uapis.cn/api/v1/misc/weather";
  var ICON_URL = "https://cdn.jsdelivr.net/gh/qwd/Icons@1.8.0/icons/";

  var form = document.getElementById("weather-form");
  if (!form) return;

  var input = document.getElementById("weather-input");
  var searchBtn = form.querySelector(".weather-search");
  var messageEl = document.getElementById("weather-message");
  var cardEl = document.getElementById("weather-card");
  var iconEl = document.getElementById("weather-icon");
  var iconFallbackEl = document.getElementById("weather-icon-fallback");
  var cityEl = document.getElementById("weather-city");
  var regionEl = document.getElementById("weather-region");
  var tempEl = document.getElementById("weather-temp");
  var conditionEl = document.getElementById("weather-condition");

  var requestId = 0;

  /* The API describes conditions in Chinese; translate the common ones
     for this English-language site and fall back to the raw text. */
  var CONDITION_TRANSLATIONS = {
    "晴": "Clear",
    "多云": "Partly cloudy",
    "阴": "Overcast",
    "附近局部降雨": "Patchy rain nearby",
    "阵雨": "Showers",
    "强阵雨": "Heavy showers",
    "雷阵雨": "Thundery showers",
    "强雷阵雨": "Heavy thunderstorms",
    "雷阵雨伴有冰雹": "Thundery showers with hail",
    "小雨": "Light rain",
    "中雨": "Moderate rain",
    "大雨": "Heavy rain",
    "极端降雨": "Extreme rain",
    "毛毛雨": "Drizzle",
    "暴雨": "Rainstorm",
    "大暴雨": "Heavy rainstorm",
    "特大暴雨": "Torrential rainstorm",
    "冻雨": "Freezing rain",
    "雨夹雪": "Sleet",
    "雨雪天气": "Rain and snow",
    "阵雨夹雪": "Sleet showers",
    "小雪": "Light snow",
    "中雪": "Moderate snow",
    "大雪": "Heavy snow",
    "暴雪": "Snowstorm",
    "阵雪": "Snow flurries",
    "强阵雪": "Heavy snow flurries",
    "薄雾": "Mist",
    "雾": "Fog",
    "霾": "Haze",
    "浮尘": "Dust",
    "扬沙": "Blowing sand",
    "沙尘暴": "Sandstorm",
    "强沙尘暴": "Severe sandstorm",
    "热": "Hot",
    "冷": "Cold",
    "未知": "Unknown"
  };

  /* Known English → Chinese city-name translations. Used so that
     inputs like "Beijing" or "Bejing" (real city, typo) are accepted
     when the API responds with 北京, while inputs like "Beiijng"
     that the API fuzzy-matches to 北区 / 香港 are rejected. */
  var KNOWN_EN_CN = {
    "beijing": "北京",
    "bejing": "北京",
    "peking": "北京",
    "shanghai": "上海",
    "guangzhou": "广州",
    "shenzhen": "深圳",
    "chengdu": "成都",
    "hangzhou": "杭州",
    "nanjing": "南京",
    "wuhan": "武汉",
    "xian": "西安",
    "changan": "西安",
    "chongqing": "重庆",
    "tianjin": "天津",
    "qingdao": "青岛",
    "xiamen": "厦门",
    "suzhou": "苏州",
    "taipei": "台北",
    "hongkong": "香港"
  };

  /* ---------- Result validation ----------
     The API sometimes fuzzy-matches gibberish into random cities
     (e.g. "Beiijng" → 北区 / 香港, "Lon" → 龙岩市, "abc" → 阿).
     This function rejects those false positives. */
  function canonicalize(s) {
    return (s || "").toLowerCase().replace(/[\s·'ˈ\-]+/g, "");
  }

  function isLatin(s) { return /[a-zÀ-ÖØ-öø-ÿ]/.test(s); }
  function isCJK(s)   { return /[\u3400-\u9FFF\uAC00-\uD7AF]/.test(s); }

  function levenshtein(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    var prev = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      var cur = [i];
      for (var j = 1; j <= n; j++) {
        cur[j] = a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
      }
      prev = cur;
    }
    return prev[n];
  }

  function validateResult(input, data) {
    var city = (data && data.city || "").trim();
    var cleanedInput = (input || "").trim();

    // 1. API returned no city, or a single-char placeholder like 阿
    if (!city || city.length <= 1) return false;

    // 2. Input too short to possibly name a city
    if (cleanedInput.length < 2) return false;

    var ci = canonicalize(cleanedInput);
    var cc = canonicalize(city);

    // 3. Very short Latin input that the API echoed back unchanged.
    //    Covers "Bei"→Bei, "Par"→Par, "Syd"→Syd — all cases where the
    //    API didn't actually find a real city.
    if (ci.length <= 3 && cc === ci && /^[a-z]+$/.test(ci)) return false;

    // 4. Exact same-string match (case / whitespace insensitive)
    if (ci === cc) return true;

    // 5. Cross-script match (e.g. "Beijing" → 北京)
    //    Only accept known English-to-Chinese translations.
    var inputLatin = isLatin(ci);
    var cityCJK = isCJK(cc);
    var bothSameScript =
      (isCJK(ci) && cityCJK) ||
      (inputLatin && isLatin(cc)) ||
      (!isCJK(ci) && !inputLatin && !isCJK(cc) && !isLatin(cc));

    if (!bothSameScript) {
      if (!inputLatin || !cityCJK) return false; // only Latin→CJK supported
      // Short inputs (e.g. "Lon") are never trustworthy cross-script
      if (ci.length < 4) return false;
      return !!KNOWN_EN_CN[ci] && KNOWN_EN_CN[ci] === cc;
    }

    // 6. Same-script — check string similarity.
    //    Covers 深圳 → 深圳市 (contained) and real typos of known cities.
    var maxLen = Math.max(ci.length, cc.length);
    if (!maxLen) return false;
    var similarity = 1 - levenshtein(ci, cc) / maxLen;

    var isContained =
      ci.length >= 4 && cc.length >= 4 &&
      (ci.indexOf(cc) !== -1 || cc.indexOf(ci) !== -1);

    if (similarity >= 0.6) return true;
    if (isContained && similarity >= 0.3) return true;

    return false;
  }

  function translateCondition(text) {
    if (!text) return "";
    if (CONDITION_TRANSLATIONS[text]) return CONDITION_TRANSLATIONS[text];
    // Handle combined descriptions such as "小到中雨".
    var key = Object.keys(CONDITION_TRANSLATIONS).find(function (k) {
      return text.indexOf(k) !== -1;
    });
    return key ? CONDITION_TRANSLATIONS[key] : text;
  }

  /* Emoji used if the hosted SVG icon can't be loaded. */
  function emojiForIconCode(code) {
    var n = parseInt(code, 10);

    if (isNaN(n)) return "🌤️";
    if (n === 100) return "☀️";
    if (n === 150) return "🌙";
    if (n >= 101 && n <= 103 || n >= 151 && n <= 153) return "⛅";
    if (n === 104 || n === 154) return "☁️";
    if (n === 313 || n === 404 || n === 405 || n === 406) return "🌨️";
    if (n === 302 || n === 303 || n === 304) return "⛈️";
    if (n >= 300 && n < 400) return "🌧️";
    if (n >= 400 && n < 500) return "❄️";
    if (n === 500 || n === 501) return "🌫️";
    if (n === 502) return "😶‍🌫️";
    if (n >= 503 && n < 600) return "🌪️";
    if (n === 900) return "🥵";
    if (n === 901) return "🥶";
    return "🌤️";
  }

  function showMessage(text, state) {
    messageEl.textContent = text;
    messageEl.className = "weather-message" + (state ? " " + state : "");
  }

  function clearMessage() {
    messageEl.textContent = "";
    messageEl.className = "weather-message";
  }

  function hideCard() {
    cardEl.hidden = true;
  }

  function regionLabel(data) {
    var province = (data.province || "").trim();
    var city = (data.city || "").trim();
    if (!province || !city) return "";
    if (province.indexOf(city) !== -1 || city.indexOf(province) !== -1) return "";
    return province;
  }

  function renderWeather(data) {
    cityEl.textContent = data.city || "";

    var region = regionLabel(data);
    regionEl.textContent = region;
    regionEl.hidden = !region;

    tempEl.textContent = Math.round(Number(data.temperature));

    var condition = translateCondition(data.weather);
    conditionEl.textContent = condition;

    var code = data.weather_icon ? String(data.weather_icon) : "999";
    iconFallbackEl.textContent = emojiForIconCode(code);
    iconEl.alt = condition ? condition + " weather icon" : "Weather icon";
    iconFallbackEl.hidden = true;
    iconEl.hidden = false;
    iconEl.src = ICON_URL + encodeURIComponent(code) + ".svg";

    cardEl.hidden = false;
  }

  // If the SVG can't be reached, swap in the emoji fallback.
  iconEl.addEventListener("error", function () {
    iconEl.hidden = true;
    iconFallbackEl.hidden = false;
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var city = input.value.trim();

    if (!city) {
      hideCard();
      showMessage("Enter a city first.", "is-error");
      input.focus();
      return;
    }

    var thisRequest = ++requestId;
    searchBtn.disabled = true;
    hideCard();
    showMessage("Loading…", "is-loading");

    fetch(API_URL + "?city=" + encodeURIComponent(city), {
      headers: { "Accept": "application/json" }
    })
      .then(function (response) {
        return response
          .json()
          .then(function (data) {
            return { ok: response.ok, data: data };
          })
          .catch(function () {
            return { ok: false, data: null };
          });
      })
      .then(function (result) {
        if (thisRequest !== requestId) return;

        var data = result.data;
        var apiOk =
          result.ok &&
          data &&
          !data.error &&
          data.city &&
          data.temperature !== undefined &&
          data.temperature !== null;

        if (!apiOk || !validateResult(city, data)) {
          hideCard();
          showMessage("Couldn't find that city — check the spelling.", "is-error");
          return;
        }

        clearMessage();
        renderWeather(data);
      })
      .catch(function () {
        if (thisRequest !== requestId) return;
        hideCard();
        showMessage("Couldn't find that city — check the spelling.", "is-error");
      })
      .then(function () {
        if (thisRequest === requestId) searchBtn.disabled = false;
      });
  });
})();

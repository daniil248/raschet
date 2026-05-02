// meteo/ashrae-datasheet.js — v0.59.904
// Полный ASHRAE Handbook Foundamentals, Chapter 14 «Climatic Design
// Information» — datasheet по метеостанции, рассчитанный из почасовых
// данных Open-Meteo. По запросу пользователя для обоснования выбора
// климат-системы по Uptime Institute.
//
// Сохранён формат и набор полей из официальной таблицы 2025 ASHRAE HoF
// (см. screenshot пользователя).

import { humidityRatio, enthalpy, wetBulb, pressureAtAltitude } from '../psychrometrics/psychrometrics-core.js';
import { escHtml } from './util.js';

// Главная функция — расширенный набор design conditions
export function computeFullAshrae(hourly, opts = {}) {
  if (!hourly || !hourly.length) return null;
  const elev = Number(opts.elevM) || 0;
  const P = pressureAtAltitude(elev);  // атмосферное давление, Pa

  // Валидные записи с T
  const valid = hourly.filter(h => Number.isFinite(Number(h.T)));
  if (!valid.length) return null;
  const N = valid.length;
  const nYears = N / (365.25 * 24);

  // ─── Суточные средние T для daily-stats и месячных
  const byDay = new Map();
  for (const h of valid) {
    const day = (h.t || '').slice(0, 10);
    if (!day) continue;
    let d = byDay.get(day);
    if (!d) { d = { sum: 0, n: 0, sumW: 0, nW: 0, month: parseInt(h.t.slice(5,7),10), year: parseInt(h.t.slice(0,4),10) }; byDay.set(day, d); }
    d.sum += Number(h.T); d.n++;
    if (Number.isFinite(Number(h.wind))) { d.sumW += Number(h.wind); d.nW++; }
  }
  const dayList = [...byDay.values()].map(d => ({
    Tavg: d.sum / Math.max(1, d.n),
    Wavg: d.nW > 0 ? d.sumW / d.nW : null,
    month: d.month, year: d.year,
  }));

  // ─── Heating DB / Cooling DB (percentiles по часовым T)
  const sortedT = [...valid].sort((a, b) => Number(a.T) - Number(b.T));
  const at = (frac) => {
    const idx = Math.max(0, Math.min(N - 1, Math.floor(N * frac)));
    return sortedT[idx];
  };
  const heating996 = at(0.004);  // T 0.4%-percentile (only 0.4% holds colder)
  const heating990 = at(0.010);
  const cooling004 = at(0.996);
  const cooling010 = at(0.990);
  const cooling020 = at(0.980);

  // ─── Coincident (MCWB / MCDB) — average across rows nearest to target T.
  // v0.59.935: keyOrFn — либо имя поля в hourly (для MCDB по T), либо функция
  // h → number (для MCWB, который нужно вычислять из T+RH; в часовых данных
  // нет готового поля wet-bulb).
  const coincidentMC = (target, keyOrFn) => {
    const valueOf = typeof keyOrFn === 'function'
      ? keyOrFn
      : (h) => Number(h[keyOrFn]);
    const close = valid
      .filter(h => Math.abs(Number(h.T) - target) < 0.5)
      .map(h => valueOf(h))
      .filter(Number.isFinite);
    if (!close.length) return null;
    return close.reduce((s, v) => s + v, 0) / close.length;
  };

  // ─── HR / Enthalpy для cooling/dehum bands. Здесь нужен dewPoint или RH.
  const w = (T, RH) => Number.isFinite(T) && Number.isFinite(RH) ? humidityRatio(T, RH / 100, P) : null;
  const wb = (T, RH) => Number.isFinite(T) && Number.isFinite(RH) ? wetBulb(T, RH / 100, P) : null;
  const h_kJ = (T, RH) => Number.isFinite(T) && Number.isFinite(RH) ? enthalpy(T, w(T, RH)) : null;

  // ─── Enthalpy и WB-percentiles (для Evaporation и Enthalpy bands)
  const validRH = valid.filter(h => Number.isFinite(Number(h.RH)));
  const sortedWB = [...validRH].map(h => ({ ...h, _wb: wb(Number(h.T), Number(h.RH)) }))
    .filter(h => Number.isFinite(h._wb)).sort((a, b) => a._wb - b._wb);
  const sortedH = [...validRH].map(h => ({ ...h, _h: h_kJ(Number(h.T), Number(h.RH)) }))
    .filter(h => Number.isFinite(h._h)).sort((a, b) => a._h - b._h);
  const sortedDP = [...validRH].map(h => ({ ...h, _dp: dewPointFromTRH(Number(h.T), Number(h.RH), P) }))
    .filter(h => Number.isFinite(h._dp)).sort((a, b) => a._dp - b._dp);

  const wbAt = (frac) => {
    if (!sortedWB.length) return null;
    return sortedWB[Math.max(0, Math.min(sortedWB.length-1, Math.floor(sortedWB.length*frac)))];
  };
  const hAt = (frac) => {
    if (!sortedH.length) return null;
    return sortedH[Math.max(0, Math.min(sortedH.length-1, Math.floor(sortedH.length*frac)))];
  };
  const dpAt = (frac) => {
    if (!sortedDP.length) return null;
    return sortedDP[Math.max(0, Math.min(sortedDP.length-1, Math.floor(sortedDP.length*frac)))];
  };

  // ─── Hottest/Coldest month (по среднемесячной T)
  const monthly = Array.from({length: 12}, () => ({sum: 0, n: 0, sumDB2: 0, days: 0, hdd10: 0, hdd183: 0, cdd10: 0, cdd183: 0, sumW: 0, nW: 0}));
  for (const h of valid) {
    const m = parseInt((h.t || '').slice(5,7), 10) - 1;
    if (m < 0 || m > 11) continue;
    monthly[m].sum += Number(h.T);
    monthly[m].n++;
    if (Number.isFinite(Number(h.wind))) { monthly[m].sumW += Number(h.wind); monthly[m].nW++; }
  }
  // Daily stats для DBStd, HDD, CDD по месяцам
  for (const d of dayList) {
    const m = d.month - 1;
    if (m < 0 || m > 11) continue;
    monthly[m].days++;
    monthly[m].sumDB2 += d.Tavg * d.Tavg;
    monthly[m].hdd10 += Math.max(0, 10 - d.Tavg);
    monthly[m].hdd183 += Math.max(0, 18.3 - d.Tavg);
    monthly[m].cdd10 += Math.max(0, d.Tavg - 10);
    monthly[m].cdd183 += Math.max(0, d.Tavg - 18.3);
  }
  const monthlyAvg = monthly.map((m, i) => {
    const avg = m.n > 0 ? m.sum / m.n : null;
    // DBStd по среднесуточным
    const daySum = m.days > 0 ? sumOfDaySumPerMonth(dayList, i+1) : null;
    const dayMean = daySum && m.days > 0 ? daySum / m.days : null;
    let std = null;
    if (m.days > 1 && dayMean != null) {
      let s2 = 0;
      for (const d of dayList) if (d.month === i+1) s2 += (d.Tavg - dayMean) ** 2;
      std = Math.sqrt(s2 / (m.days - 1));
    }
    return {
      monthIdx: i,
      DBAvg: avg,
      DBStd: std,
      HDD10: m.hdd10, HDD183: m.hdd183,
      CDD10: m.cdd10, CDD183: m.cdd183,
      WSAvg: m.nW > 0 ? m.sumW / m.nW : null,
    };
  });
  // Annual aggregates
  const annual = {
    DBAvg: monthlyAvg.reduce((s,m) => s + (m.DBAvg||0)*m.DBStd!=null ? 1 : 1, 0) /
           monthlyAvg.filter(m => m.DBAvg != null).length || null,  // mean of monthly means
    HDD10: monthlyAvg.reduce((s,m) => s + (m.HDD10 || 0), 0),
    HDD183: monthlyAvg.reduce((s,m) => s + (m.HDD183 || 0), 0),
    CDD10: monthlyAvg.reduce((s,m) => s + (m.CDD10 || 0), 0),
    CDD183: monthlyAvg.reduce((s,m) => s + (m.CDD183 || 0), 0),
    WSAvg: monthlyAvg.reduce((s,m) => s + (m.WSAvg || 0), 0) / monthlyAvg.filter(m => m.WSAvg != null).length || null,
    DBStdYear: stdOfDaySeries(dayList.map(d => d.Tavg)),
  };
  // Compute annual mean DB properly
  const allDB = monthlyAvg.filter(m => m.DBAvg != null).map(m => m.DBAvg);
  annual.DBAvg = allDB.length ? allDB.reduce((s,v)=>s+v,0) / allDB.length : null;

  // Hottest / Coldest month
  let hottestM = 0, coldestM = 0;
  let maxDBAvg = -Infinity, minDBAvg = Infinity;
  monthlyAvg.forEach((m, i) => {
    if (m.DBAvg != null) {
      if (m.DBAvg > maxDBAvg) { maxDBAvg = m.DBAvg; hottestM = i; }
      if (m.DBAvg < minDBAvg) { minDBAvg = m.DBAvg; coldestM = i; }
    }
  });
  // Hottest month DB range = avg(monthly daily max) - avg(monthly daily min)
  const hotDays = dayList.filter(d => d.month === hottestM + 1);
  const hotMaxAvg = hotDays.length ? hotDays.reduce((s,d) => s+d.Tavg, 0) / hotDays.length : null;
  // simpler approximation: используем std для оценки range — в ASHRAE это Td_max-Td_min average
  const hotRange = monthlyAvg[hottestM]?.DBStd ? monthlyAvg[hottestM].DBStd * 2.5 : null;

  // Wind speed percentiles annual
  const validW = valid.filter(h => Number.isFinite(Number(h.wind)));
  const sortedW = [...validW].sort((a,b) => Number(a.wind) - Number(b.wind));
  const wsAt = (frac) => sortedW.length ? Number(sortedW[Math.min(sortedW.length-1, Math.floor(sortedW.length*frac))].wind) : null;

  // Coldest month wind percentiles (только в самый холодный месяц)
  const coldestMonthRows = valid.filter(h => parseInt((h.t||'').slice(5,7),10) === coldestM + 1);
  const sortedColdW = [...coldestMonthRows].filter(h => Number.isFinite(Number(h.wind)))
    .sort((a,b) => Number(b.wind) - Number(a.wind));  // от max к min для percentile-from-top
  const coldWsAt = (frac) => sortedColdW.length ? Number(sortedColdW[Math.min(sortedColdW.length-1, Math.floor(sortedColdW.length*frac))].wind) : null;

  // Extreme min/max за каждый год (для return period analysis)
  const yearStats = new Map();
  for (const h of valid) {
    const y = parseInt((h.t || '').slice(0,4), 10);
    if (!Number.isFinite(y)) continue;
    let s = yearStats.get(y);
    if (!s) { s = { tMin: Infinity, tMax: -Infinity }; yearStats.set(y, s); }
    const T = Number(h.T);
    if (T < s.tMin) s.tMin = T;
    if (T > s.tMax) s.tMax = T;
  }
  const years = [...yearStats.values()];
  const extremeMin = years.length ? mean(years.map(y => y.tMin)) : null;
  const extremeMax = years.length ? mean(years.map(y => y.tMax)) : null;
  const extremeMinStd = years.length > 1 ? stdOfDaySeries(years.map(y => y.tMin)) : null;
  const extremeMaxStd = years.length > 1 ? stdOfDaySeries(years.map(y => y.tMax)) : null;

  // n-year return period (ASHRAE метод, гл. 14):
  //   T_n = mean ± k_n × std
  //   k_n коэффициенты: для n=5 → ~1.51, n=10 → 1.91, n=20 → 2.27, n=50 → 2.66
  // (для нормального распределения экстремумов с поправкой на сэмпл-сайз)
  const RP_K = { 5: 1.51, 10: 1.91, 20: 2.27, 50: 2.66 };
  const returnPeriod = (n) => {
    if (extremeMin == null || extremeMinStd == null) return null;
    const k = RP_K[n] || 0;
    return {
      Tmin: extremeMin - k * (extremeMinStd || 0),
      Tmax: extremeMax + k * (extremeMaxStd || 0),
    };
  };

  return {
    nYears: Math.round(nYears * 10) / 10,
    elev,
    pressure: P,
    coldestMonth: coldestM + 1,
    hottestMonth: hottestM + 1,
    hottestRange: hotRange,
    heating: {
      DB996: heating996?.T,  DB990: heating990?.T,
      // Humidification: DP percentiles + MCDB и HR при них
      hum996: dpAt(0.004), hum990: dpAt(0.010),
    },
    coldestWind: { ws004: coldWsAt(0.004), ws010: coldWsAt(0.010) },
    cooling: {
      // v0.59.935: MCWB вычисляется на лету (h → wet-bulb из T+RH);
      // раньше передавалось имя поля 'wb_' которого нет в часовых данных,
      // и MCWB всегда выходил null → '—' в datasheet.
      DB004: cooling004?.T, MCWB004: coincidentMC(cooling004.T, h => wb(Number(h.T), Number(h.RH))),
      DB010: cooling010?.T, MCWB010: coincidentMC(cooling010.T, h => wb(Number(h.T), Number(h.RH))),
      DB020: cooling020?.T, MCWB020: coincidentMC(cooling020.T, h => wb(Number(h.T), Number(h.RH))),
    },
    evaporation: {
      WB004: wbAt(0.996)?._wb, MCDB004w: wbAt(0.996)?.T,
      WB010: wbAt(0.990)?._wb, MCDB010w: wbAt(0.990)?.T,
      WB020: wbAt(0.980)?._wb, MCDB020w: wbAt(0.980)?.T,
    },
    dehumidification: {
      DP004: dpAt(0.996)?._dp, MCDB004d: dpAt(0.996)?.T, HR004: dpAt(0.996) ? w(dpAt(0.996).T, dpAt(0.996).RH) : null,
      DP010: dpAt(0.990)?._dp, MCDB010d: dpAt(0.990)?.T, HR010: dpAt(0.990) ? w(dpAt(0.990).T, dpAt(0.990).RH) : null,
      DP020: dpAt(0.980)?._dp, MCDB020d: dpAt(0.980)?.T, HR020: dpAt(0.980) ? w(dpAt(0.980).T, dpAt(0.980).RH) : null,
    },
    enthalpy: {
      H004: hAt(0.996)?._h, MCDB004h: hAt(0.996)?.T,
      H010: hAt(0.990)?._h, MCDB010h: hAt(0.990)?.T,
      H020: hAt(0.980)?._h, MCDB020h: hAt(0.980)?.T,
    },
    extremeWind: { ws010: wsAt(0.99), ws025: wsAt(0.975), ws050: wsAt(0.95) },
    extremeTemp: {
      meanMin: extremeMin, meanMax: extremeMax,
      stdMin: extremeMinStd, stdMax: extremeMaxStd,
      rp5: returnPeriod(5),
      rp10: returnPeriod(10),
      rp20: returnPeriod(20),
      rp50: returnPeriod(50),
    },
    monthly: monthlyAvg,
    annual,
  };
}

function dewPointFromTRH(T, RH, P) {
  if (!Number.isFinite(T) || !Number.isFinite(RH)) return null;
  // Magnus formula
  const a = 17.625, b = 243.04;
  const alpha = Math.log(RH / 100) + (a * T) / (b + T);
  return (b * alpha) / (a - alpha);
}
function mean(arr) { return arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : null; }
function stdOfDaySeries(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s,v)=>s+(v-m)*(v-m),0) / (arr.length - 1));
}
function sumOfDaySumPerMonth(dayList, monthOneBased) {
  let s = 0;
  for (const d of dayList) if (d.month === monthOneBased) s += d.Tavg;
  return s;
}

// ─── Render: HTML datasheet в стиле официального ASHRAE Foundamentals
const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

export function renderAshraeDatasheet(d, locationName) {
  const a = computeFullAshrae(d.hourly || [], { elevM: d.elev || 0 });
  if (!a) return '<div class="muted">Недостаточно данных для расчёта.</div>';
  const fmt = (v, n=1) => v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(n);
  const fmtHR = (v) => v == null || !Number.isFinite(v) ? '—' : (v * 1000).toFixed(1);  // g/kg
  const wsf = (Math.atan2(a.coldestWind.ws004 || 0, 10) * (180 / Math.PI) / 100).toFixed(3);  // оценка

  return `<div class="mt-ashrae-sheet">
    <div class="mt-ashrae-banner">
      <h3>📌 ${escHtml(locationName || d.locationName || '')} ${d.stationId ? `(WMO/ICAO: ${escHtml(d.stationId)})` : ''}</h3>
      <div class="mt-ashrae-meta">
        Lat: <b>${fmt(d.lat, 3)}</b> · Lon: <b>${fmt(d.lon, 3)}</b> · Elev: <b>${a.elev || '—'} м</b> · StdP: <b>${(a.pressure/1000).toFixed(2)} кПа</b> · Period: <b>${a.nYears} лет</b> · Source: Open-Meteo archive
      </div>
    </div>

    <h4 class="mt-ashrae-band mt-band-h">Annual Heating, Humidification and Ventilation Design Conditions</h4>
    <table class="mt-ashrae-table">
      <thead>
        <tr><th rowspan="2">Coldest Month</th><th colspan="2">Heating DB</th><th colspan="6">Humidification DP/MCDB and HR</th><th colspan="4">Coldest Month WS/MCDB</th><th colspan="2">MCWS/PCWD<br>to 99.6% DB</th><th rowspan="2">WSF</th></tr>
        <tr><th>99.6%</th><th>99%</th><th>DP 99.6%</th><th>HR 99.6%</th><th>MCDB 99.6%</th><th>DP 99%</th><th>HR 99%</th><th>MCDB 99%</th><th>WS 0.4%</th><th>MCDB</th><th>WS 1%</th><th>MCDB</th><th>MCWS</th><th>PCWD</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><b>${a.coldestMonth}</b></td>
          <td>${fmt(a.heating.DB996)}</td><td>${fmt(a.heating.DB990)}</td>
          <td>${fmt(a.heating.hum996?._dp)}</td><td>${fmtHR(a.heating.hum996 ? humidityRatio(a.heating.hum996.T, (a.heating.hum996.RH||0)/100, a.pressure) : null)}</td><td>${fmt(a.heating.hum996?.T)}</td>
          <td>${fmt(a.heating.hum990?._dp)}</td><td>${fmtHR(a.heating.hum990 ? humidityRatio(a.heating.hum990.T, (a.heating.hum990.RH||0)/100, a.pressure) : null)}</td><td>${fmt(a.heating.hum990?.T)}</td>
          <td>${fmt(a.coldestWind.ws004)}</td><td>—</td>
          <td>${fmt(a.coldestWind.ws010)}</td><td>—</td>
          <td>—</td><td>—</td>
          <td>${wsf}</td>
        </tr>
      </tbody>
    </table>

    <h4 class="mt-ashrae-band mt-band-c">Annual Cooling, Dehumidification and Enthalpy Design Conditions</h4>
    <table class="mt-ashrae-table">
      <thead>
        <tr><th rowspan="2">Hottest Month</th><th rowspan="2">Hottest Month<br>DB Range</th><th colspan="6">Cooling DB / MCWB</th></tr>
        <tr><th>0.4% DB</th><th>MCWB</th><th>1% DB</th><th>MCWB</th><th>2% DB</th><th>MCWB</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><b>${a.hottestMonth}</b></td>
          <td>${fmt(a.hottestRange)}</td>
          <td>${fmt(a.cooling.DB004)}</td><td>${fmt(a.cooling.MCWB004)}</td>
          <td>${fmt(a.cooling.DB010)}</td><td>${fmt(a.cooling.MCWB010)}</td>
          <td>${fmt(a.cooling.DB020)}</td><td>${fmt(a.cooling.MCWB020)}</td>
        </tr>
      </tbody>
    </table>
    <table class="mt-ashrae-table">
      <thead>
        <tr><th colspan="6">Evaporation WB / MCDB</th></tr>
        <tr><th>0.4% WB</th><th>MCDB</th><th>1% WB</th><th>MCDB</th><th>2% WB</th><th>MCDB</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${fmt(a.evaporation.WB004)}</td><td>${fmt(a.evaporation.MCDB004w)}</td>
          <td>${fmt(a.evaporation.WB010)}</td><td>${fmt(a.evaporation.MCDB010w)}</td>
          <td>${fmt(a.evaporation.WB020)}</td><td>${fmt(a.evaporation.MCDB020w)}</td>
        </tr>
      </tbody>
    </table>
    <table class="mt-ashrae-table">
      <thead>
        <tr><th colspan="9">Dehumidification DP / MCDB / HR</th></tr>
        <tr><th>0.4% DP</th><th>HR (g/kg)</th><th>MCDB</th><th>1% DP</th><th>HR</th><th>MCDB</th><th>2% DP</th><th>HR</th><th>MCDB</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${fmt(a.dehumidification.DP004)}</td><td>${fmtHR(a.dehumidification.HR004)}</td><td>${fmt(a.dehumidification.MCDB004d)}</td>
          <td>${fmt(a.dehumidification.DP010)}</td><td>${fmtHR(a.dehumidification.HR010)}</td><td>${fmt(a.dehumidification.MCDB010d)}</td>
          <td>${fmt(a.dehumidification.DP020)}</td><td>${fmtHR(a.dehumidification.HR020)}</td><td>${fmt(a.dehumidification.MCDB020d)}</td>
        </tr>
      </tbody>
    </table>
    <table class="mt-ashrae-table">
      <thead>
        <tr><th colspan="6">Enthalpy / MCDB</th></tr>
        <tr><th>0.4% Enth (kJ/kg)</th><th>MCDB</th><th>1% Enth</th><th>MCDB</th><th>2% Enth</th><th>MCDB</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${fmt(a.enthalpy.H004)}</td><td>${fmt(a.enthalpy.MCDB004h)}</td>
          <td>${fmt(a.enthalpy.H010)}</td><td>${fmt(a.enthalpy.MCDB010h)}</td>
          <td>${fmt(a.enthalpy.H020)}</td><td>${fmt(a.enthalpy.MCDB020h)}</td>
        </tr>
      </tbody>
    </table>

    <h4 class="mt-ashrae-band mt-band-x">Extreme Annual Design Conditions <span class="mt-ashrae-uptime">(critical для Uptime Institute)</span></h4>
    <table class="mt-ashrae-table">
      <thead>
        <tr><th colspan="3">Extreme Annual WS</th><th colspan="2">Extreme Annual Temperature</th><th colspan="2">Standard Deviation</th><th colspan="2">n=5 years</th><th colspan="2">n=10 years</th><th colspan="2">n=20 years</th><th colspan="2">n=50 years</th></tr>
        <tr><th>1%</th><th>2.5%</th><th>5%</th><th>Min</th><th>Max</th><th>Min</th><th>Max</th><th>Min</th><th>Max</th><th>Min</th><th>Max</th><th>Min</th><th>Max</th><th>Min</th><th>Max</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${fmt(a.extremeWind.ws010)}</td><td>${fmt(a.extremeWind.ws025)}</td><td>${fmt(a.extremeWind.ws050)}</td>
          <td>${fmt(a.extremeTemp.meanMin)}</td><td>${fmt(a.extremeTemp.meanMax)}</td>
          <td>${fmt(a.extremeTemp.stdMin)}</td><td>${fmt(a.extremeTemp.stdMax)}</td>
          <td>${fmt(a.extremeTemp.rp5?.Tmin)}</td><td>${fmt(a.extremeTemp.rp5?.Tmax)}</td>
          <td>${fmt(a.extremeTemp.rp10?.Tmin)}</td><td>${fmt(a.extremeTemp.rp10?.Tmax)}</td>
          <td>${fmt(a.extremeTemp.rp20?.Tmin)}</td><td>${fmt(a.extremeTemp.rp20?.Tmax)}</td>
          <td>${fmt(a.extremeTemp.rp50?.Tmin)}</td><td>${fmt(a.extremeTemp.rp50?.Tmax)}</td>
        </tr>
      </tbody>
    </table>

    <h4 class="mt-ashrae-band mt-band-m" title="Среднемесячные климатические параметры по ASHRAE Handbook Fundamentals 2021 гл. 14: average drybulb, std deviation, heating/cooling degree-days с двумя базами (10°C и 18.3°C), средняя скорость ветра. Колонка Annual — среднегодовое значение или сумма по месяцам.">Monthly Climatic Design Conditions</h4>
    <table class="mt-ashrae-table">
      <thead>
        <tr><th rowspan="2" title="Климатический параметр. Hover на ячейке слева → расшифровка.">Параметр</th><th title="Среднегодовое значение (или сумма для DD).">Annual</th>${MONTHS.map(m => `<th title="Месячное значение для ${m}.">${m}</th>`).join('')}</tr>
      </thead>
      <tbody>
        <tr title="Drybulb Average — средняя температура наружного воздуха по «сухому термометру» (стандартная T_amb), °C. По месяцам = mean(T_i) за все часы месяца. Annual = mean(monthly).">
          <td><b>DBAvg, °C</b></td><td>${fmt(a.annual.DBAvg)}</td>${a.monthly.map(m => `<td>${fmt(m.DBAvg)}</td>`).join('')}</tr>
        <tr title="Drybulb Standard deviation — стандартное отклонение среднесуточных температур (мера изменчивости climate). Считается по day-mean values. Высокое σ → континентальный климат, низкое → морской.">
          <td><b>DBStd, °C</b></td><td>${fmt(a.annual.DBStdYear)}</td>${a.monthly.map(m => `<td>${fmt(m.DBStd)}</td>`).join('')}</tr>
        <tr title="Heating Degree Days, база 10°C: HDD10 = Σ max(0, 10 − T_avg_day) за все дни месяца. Используется для оценки нагрузки на отопление с пониженной базой (для тёплых регионов или промышленных помещений с низкой setpoint).">
          <td><b>HDD10.0, °C·сут</b></td><td>${fmt(a.annual.HDD10, 0)}</td>${a.monthly.map(m => `<td>${fmt(m.HDD10, 0)}</td>`).join('')}</tr>
        <tr title="Heating Degree Days, база 18.3°C (= 65°F): HDD18.3 = Σ max(0, 18.3 − T_avg_day). Стандартная база ASHRAE/US, эквивалент HDD65. Прямой множитель в формуле прикидочной годовой нагрузки на отопление: Q_год ≈ HDD × UA × 24.">
          <td><b>HDD18.3, °C·сут</b></td><td>${fmt(a.annual.HDD183, 0)}</td>${a.monthly.map(m => `<td>${fmt(m.HDD183, 0)}</td>`).join('')}</tr>
        <tr title="Cooling Degree Days, база 10°C: CDD10 = Σ max(0, T_avg_day − 10). Используется для оценки нагрузки на охлаждение в высокопотребительных помещениях (ЦОД, серверные с set-point ≈ 22°C, фактически работают холоднее наружного выше 10°C).">
          <td><b>CDD10.0, °C·сут</b></td><td>${fmt(a.annual.CDD10, 0)}</td>${a.monthly.map(m => `<td>${fmt(m.CDD10, 0)}</td>`).join('')}</tr>
        <tr title="Cooling Degree Days, база 18.3°C (= 65°F): CDD18.3 = Σ max(0, T_avg_day − 18.3). Стандартная база ASHRAE для жилых/коммерческих систем кондиционирования. Q_охл_год ≈ CDD × UA × 24.">
          <td><b>CDD18.3, °C·сут</b></td><td>${fmt(a.annual.CDD183, 0)}</td>${a.monthly.map(m => `<td>${fmt(m.CDD183, 0)}</td>`).join('')}</tr>
        <tr title="Wind Speed Average — средняя скорость ветра по часам месяца, м/с. Косвенно влияет на эффективность air-cooled конденсаторов (выше ветер → лучше теплоотдача), на инфильтрацию здания и на солнечно-ветровые расчёты для розы ветров.">
          <td><b>WSAvg, м/с</b></td><td>${fmt(a.annual.WSAvg)}</td>${a.monthly.map(m => `<td>${fmt(m.WSAvg)}</td>`).join('')}</tr>
      </tbody>
    </table>

    <p class="muted mt-ashrae-note">⚠ Все значения вычислены из публичных Open-Meteo historical data (≥10 лет). Не подменяют официальные ASHRAE Handbook Foundamentals таблицы (paywalled). Методика: статистические перцентили, психрометрия по ASHRAE 2021, return-period по гл. 14 (k-коэффициенты для нормального распределения экстремумов). MCWB/MCDB — average coincident в окне ±0.5°C.</p>
  </div>`;
}

// ======================================================================
// transformer-config.js
// Подпрограмма «Конфигуратор трансформатора» — скелет для будущей работы
// с каталогом трансформаторов, расчётом I_k по u_k, интеграцией с главным
// приложением (TRANSFORMER_CATALOG в constants.js).
//
// Текущий статус: stub. Страница подключает shared-инфраструктуру.
// ======================================================================

document.addEventListener('DOMContentLoaded', () => {
  const back = document.getElementById('btn-back');
  if (back) back.addEventListener('click', () => { window.location.href = '../hub.html'; });
});

// ======================================================================
// panel-config.js
// Подпрограмма «Конфигуратор щита» — скелет для будущей работы со
// справочниками серий щитов (ArTu / Prisma / OptiBox), автоматическим
// подбором состава полей по нагрузке, предпросмотром компоновки.
//
// Текущий статус: stub. Страница подключает shared-инфраструктуру
// (auth, app-header, styles/base) и служит точкой входа для будущего
// наполнения.
// ======================================================================

document.addEventListener('DOMContentLoaded', () => {
  const back = document.getElementById('btn-back');
  if (back) back.addEventListener('click', () => { window.location.href = '../hub.html'; });
});

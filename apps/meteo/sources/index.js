// meteo/sources/index.js
// Точка-импорт всех плагинов источников. Чтобы добавить новый источник:
//   1. Создайте meteo/sources/<name>.js по примеру open-meteo.js или rp5.js
//   2. Добавьте импорт в этот файл
//   3. Готово — кнопка появится в UI автоматически.
//
// Подключение делается через side-effect import (плагин сам вызывает register
// в момент загрузки), поэтому здесь только импорты.

import './open-meteo.js';
import './rp5.js';
import './ashrae.js';
import './csv-generic.js';
// import './noaa.js';        ← пример: будущий источник NOAA Climate Data
// import './roshydromet.js'; ← пример: будущий Росгидромет API

export { register, getAll, get } from './registry.js';

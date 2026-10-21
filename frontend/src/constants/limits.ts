/**
 * 契约里带具体数字的上限（`docs/api-contract.md` §4.1.1）。
 *
 * 单列一处的理由：这些数字同时出现在「前台渲染上限」与「后台编辑区禁用条件」两处，
 * 抄两份必然漂移——上限一旦变，界面要么在真该禁用时没禁用，要么在还没超时就挡了用户。
 */

/** 每个项目最多 10 张截图（第 11 张整批 400）。 */
export const SCREENSHOT_MAX = 10

/** 截图图注上限（裁剪后计长度）。 */
export const SCREENSHOT_CAPTION_MAX = 80

/** 截图 URL 上限。 */
export const SCREENSHOT_URL_MAX = 2048

/** 指标卡条目数上限：超过即整批 400，界面在到上限时就该禁用「添加」。 */
export const METRIC_MAX = 2

/** 指标卡标签长度上限（比 `meta` 的 50 严得多，格子放不下更长的）。 */
export const METRIC_KEY_LABEL_MAX = 16

/** 指标卡数值长度上限。 */
export const METRIC_VALUE_MAX = 12

/** 普通元数据条目的键 / 值长度上限。 */
export const META_KEY_LABEL_MAX = 50
export const META_VALUE_MAX = 500

/** 元数据条目总数上限。 */
export const METADATA_MAX = 50

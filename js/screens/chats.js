// تبويب المحادثات: مجموعات محادثة مستقلة عن منشورات الأعمال (نفس شاشة المجموعات بنمط "chat")
import { mountMode, unmount } from './group.js';

export const title = 'المحادثات';
export const mount = (root) => mountMode(root, 'chat');
export { unmount };

/** 描画テストに必要な子要素、属性、クラスの振る舞いを補います。 */
export function withOverlayDOM<T extends Record<string, any>>(element: T): T {
    const node = element as Record<string, any>;
    const children: any[] = [];
    const attributes = new Map<string, string>();
    node.ownerDocument = globalThis.document;
    node.offsetHeight ??= 0;
    node.scrollHeight ??= 0;
    node.scrollWidth ??= 0;
    node.addEventListener ??= () => {};
    node.removeEventListener ??= () => {};
    node.children = children;
    Object.defineProperty(node, 'firstChild', { get: () => children[0] ?? null });
    node.appendChild = (child: any) => { children.push(child); child.parentNode = node; return child; };
    node.append = (...nodes: any[]) => nodes.forEach(child => node.appendChild(child));
    node.removeChild = (child: any) => { const index = children.indexOf(child); if (index >= 0) children.splice(index, 1); child.parentNode = null; return child; };
    node.setAttribute = (name: string, value: string) => attributes.set(name, value);
    node.getAttribute = (name: string) => attributes.get(name) ?? null;
    const classes = () => new Set<string>((node.className ?? '').split(/\s+/).filter(Boolean));
    node.classList = {
        add: (...names: string[]) => { node.className = [...new Set([...classes(), ...names])].join(' '); },
        remove: (...names: string[]) => { node.className = [...classes()].filter(name => !names.includes(name)).join(' '); },
        contains: (name: string) => classes().has(name),
        toggle: (name: string, force?: boolean) => {
            const add = force ?? !classes().has(name);
            if (add) node.classList.add(name); else node.classList.remove(name);
            return add;
        },
    };
    node.querySelectorAll = (selector: string): any[] => children.flatMap(child => [
        ...(selector.startsWith('.') && child.classList?.contains(selector.slice(1)) ? [child] : []),
        ...(child.querySelectorAll?.(selector) ?? []),
    ]);
    node.querySelector = (selector: string) => node.querySelectorAll(selector)[0] ?? null;
    return element;
}

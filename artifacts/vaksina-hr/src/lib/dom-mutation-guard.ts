/**
 * Brauzer tarjimasi / extension React egalik qilgan matn tugunlarini almashtirganda
 * insertBefore / removeChild NotFoundError beradi. Xavfsiz no-op qilib crash’ni oldini olamiz.
 * @see https://github.com/facebook/react/issues/11538
 */
export function installDomMutationGuard(): void {
  if (typeof Node !== "function" || !Node.prototype) return;
  const w = window as Window & { __hrDomMutationGuard?: boolean };
  if (w.__hrDomMutationGuard) return;
  w.__hrDomMutationGuard = true;

  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(
    newNode: T,
    referenceNode: Node | null,
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      return newNode;
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };
}

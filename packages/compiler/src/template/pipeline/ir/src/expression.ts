/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import * as o from '../../../../output/output_ast';
import type {ParseSourceSpan} from '../../../../parse_util';

import * as t from '../../../../render3/r3_ast';
import {ExpressionKind, OpKind, SanitizerFn} from './enums';
import {ConsumesVarsTrait, UsesSlotIndex, UsesSlotIndexTrait, UsesVarOffset, UsesVarOffsetTrait} from './traits';

import type {XrefId} from './operations';
import type {CreateOp} from './ops/create';
import {Interpolation, type UpdateOp} from './ops/update';

/**
 * An `o.Expression` subtype representing a logical expression in the intermediate representation.
 */
export type Expression = LexicalReadExpr|ReferenceExpr|ContextExpr|NextContextExpr|
    GetCurrentViewExpr|RestoreViewExpr|ResetViewExpr|ReadVariableExpr|PureFunctionExpr|
    PureFunctionParameterExpr|PipeBindingExpr|PipeBindingVariadicExpr|SafePropertyReadExpr|
    SafeKeyedReadExpr|SafeInvokeFunctionExpr|EmptyExpr|AssignTemporaryExpr|ReadTemporaryExpr|
    SanitizerExpr|SlotLiteralExpr|ConditionalCaseExpr|DerivedRepeaterVarExpr;

/**
 * Transformer type which converts expressions into general `o.Expression`s (which may be an
 * identity transformation).
 */
export type ExpressionTransform = (expr: o.Expression, flags: VisitorContextFlag) => o.Expression;

/**
 * Check whether a given `o.Expression` is a logical IR expression type.
 */
export function isIrExpression(expr: o.Expression): expr is Expression {
  return expr instanceof ExpressionBase;
}

/**
 * Base type used for all logical IR expressions.
 */
export abstract class ExpressionBase extends o.Expression {
  abstract readonly kind: ExpressionKind;

  constructor(sourceSpan: ParseSourceSpan|null = null) {
    super(null, sourceSpan);
  }

  /**
   * Run the transformer against any nested expressions which may be present in this IR expression
   * subtype.
   */
  abstract transformInternalExpressions(transform: ExpressionTransform, flags: VisitorContextFlag):
      void;
}

/**
 * Logical expression representing a lexical read of a variable name.
 */
export class LexicalReadExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.LexicalRead;

  constructor(readonly name: string) {
    super();
  }

  override visitExpression(visitor: o.ExpressionVisitor, context: any): void {}

  override isEquivalent(other: LexicalReadExpr): boolean {
    // We assume that the lexical reads are in the same context, which must be true for parent
    // expressions to be equivalent.
    // TODO: is this generally safe?
    return this.name === other.name;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(): void {}

  override clone(): LexicalReadExpr {
    return new LexicalReadExpr(this.name);
  }
}

/**
 * Runtime operation to retrieve the value of a local reference.
 */
export class ReferenceExpr extends ExpressionBase implements UsesSlotIndexTrait {
  override readonly kind = ExpressionKind.Reference;

  readonly[UsesSlotIndex] = true;

  targetSlot: number|null = null;

  constructor(readonly target: XrefId, readonly offset: number) {
    super();
  }

  override visitExpression(): void {}

  override isEquivalent(e: o.Expression): boolean {
    return e instanceof ReferenceExpr && e.target === this.target;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(): void {}

  override clone(): ReferenceExpr {
    const expr = new ReferenceExpr(this.target, this.offset);
    expr.targetSlot = this.targetSlot;
    return expr;
  }
}

/**
 * A reference to the current view context (usually the `ctx` variable in a template function).
 */
export class ContextExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.Context;

  constructor(readonly view: XrefId) {
    super();
  }

  override visitExpression(): void {}

  override isEquivalent(e: o.Expression): boolean {
    return e instanceof ContextExpr && e.view === this.view;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(): void {}

  override clone(): ContextExpr {
    return new ContextExpr(this.view);
  }
}

/**
 * A reference to the current view context inside a track function.
 */
export class TrackContextExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.TrackContext;

  constructor(readonly view: XrefId) {
    super();
  }

  override visitExpression(): void {}

  override isEquivalent(e: o.Expression): boolean {
    return e instanceof TrackContextExpr && e.view === this.view;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(): void {}

  override clone(): TrackContextExpr {
    return new TrackContextExpr(this.view);
  }
}

/**
 * Runtime operation to navigate to the next view context in the view hierarchy.
 */
export class NextContextExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.NextContext;

  steps = 1;

  constructor() {
    super();
  }

  override visitExpression(): void {}

  override isEquivalent(e: o.Expression): boolean {
    return e instanceof NextContextExpr && e.steps === this.steps;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(): void {}

  override clone(): NextContextExpr {
    const expr = new NextContextExpr();
    expr.steps = this.steps;
    return expr;
  }
}

/**
 * Runtime operation to snapshot the current view context.
 *
 * The result of this operation can be stored in a variable and later used with the `RestoreView`
 * operation.
 */
export class GetCurrentViewExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.GetCurrentView;

  constructor() {
    super();
  }

  override visitExpression(): void {}

  override isEquivalent(e: o.Expression): boolean {
    return e instanceof GetCurrentViewExpr;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(): void {}

  override clone(): GetCurrentViewExpr {
    return new GetCurrentViewExpr();
  }
}

/**
 * Runtime operation to restore a snapshotted view.
 */
export class RestoreViewExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.RestoreView;

  constructor(public view: XrefId|o.Expression) {
    super();
  }

  override visitExpression(visitor: o.ExpressionVisitor, context: any): void {
    if (typeof this.view !== 'number') {
      this.view.visitExpression(visitor, context);
    }
  }

  override isEquivalent(e: o.Expression): boolean {
    if (!(e instanceof RestoreViewExpr) || typeof e.view !== typeof this.view) {
      return false;
    }

    if (typeof this.view === 'number') {
      return this.view === e.view;
    } else {
      return this.view.isEquivalent(e.view as o.Expression);
    }
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(transform: ExpressionTransform, flags: VisitorContextFlag):
      void {
    if (typeof this.view !== 'number') {
      this.view = transformExpressionsInExpression(this.view, transform, flags);
    }
  }

  override clone(): RestoreViewExpr {
    return new RestoreViewExpr(this.view instanceof o.Expression ? this.view.clone() : this.view);
  }
}

/**
 * Runtime operation to reset the current view context after `RestoreView`.
 */
export class ResetViewExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.ResetView;

  constructor(public expr: o.Expression) {
    super();
  }

  override visitExpression(visitor: o.ExpressionVisitor, context: any): any {
    this.expr.visitExpression(visitor, context);
  }

  override isEquivalent(e: o.Expression): boolean {
    return e instanceof ResetViewExpr && this.expr.isEquivalent(e.expr);
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(transform: ExpressionTransform, flags: VisitorContextFlag):
      void {
    this.expr = transformExpressionsInExpression(this.expr, transform, flags);
  }

  override clone(): ResetViewExpr {
    return new ResetViewExpr(this.expr.clone());
  }
}

/**
 * Read of a variable declared as an `ir.VariableOp` and referenced through its `ir.XrefId`.
 */
export class ReadVariableExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.ReadVariable;
  name: string|null = null;
  constructor(readonly xref: XrefId) {
    super();
  }

  override visitExpression(): void {}

  override isEquivalent(other: o.Expression): boolean {
    return other instanceof ReadVariableExpr && other.xref === this.xref;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(): void {}

  override clone(): ReadVariableExpr {
    const expr = new ReadVariableExpr(this.xref);
    expr.name = this.name;
    return expr;
  }
}

export class PureFunctionExpr extends ExpressionBase implements ConsumesVarsTrait,
                                                                UsesVarOffsetTrait {
  override readonly kind = ExpressionKind.PureFunctionExpr;
  readonly[ConsumesVarsTrait] = true;
  readonly[UsesVarOffset] = true;

  varOffset: number|null = null;

  /**
   * The expression which should be memoized as a pure computation.
   *
   * This expression contains internal `PureFunctionParameterExpr`s, which are placeholders for the
   * positional argument expressions in `args.
   */
  body: o.Expression|null;

  /**
   * Positional arguments to the pure function which will memoize the `body` expression, which act
   * as memoization keys.
   */
  args: o.Expression[];

  /**
   * Once extracted to the `ConstantPool`, a reference to the function which defines the computation
   * of `body`.
   */
  fn: o.Expression|null = null;

  constructor(expression: o.Expression|null, args: o.Expression[]) {
    super();
    this.body = expression;
    this.args = args;
  }

  override visitExpression(visitor: o.ExpressionVisitor, context: any) {
    this.body?.visitExpression(visitor, context);
    for (const arg of this.args) {
      arg.visitExpression(visitor, context);
    }
  }

  override isEquivalent(other: o.Expression): boolean {
    if (!(other instanceof PureFunctionExpr) || other.args.length !== this.args.length) {
      return false;
    }

    return other.body !== null && this.body !== null && other.body.isEquivalent(this.body) &&
        other.args.every((arg, idx) => arg.isEquivalent(this.args[idx]));
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(transform: ExpressionTransform, flags: VisitorContextFlag):
      void {
    if (this.body !== null) {
      // TODO: figure out if this is the right flag to pass here.
      this.body = transformExpressionsInExpression(
          this.body, transform, flags | VisitorContextFlag.InChildOperation);
    } else if (this.fn !== null) {
      this.fn = transformExpressionsInExpression(this.fn, transform, flags);
    }

    for (let i = 0; i < this.args.length; i++) {
      this.args[i] = transformExpressionsInExpression(this.args[i], transform, flags);
    }
  }

  override clone(): PureFunctionExpr {
    const expr =
        new PureFunctionExpr(this.body?.clone() ?? null, this.args.map(arg => arg.clone()));
    expr.fn = this.fn?.clone() ?? null;
    expr.varOffset = this.varOffset;
    return expr;
  }
}

export class PureFunctionParameterExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.PureFunctionParameterExpr;

  constructor(public index: number) {
    super();
  }

  override visitExpression(): void {}

  override isEquivalent(other: o.Expression): boolean {
    return other instanceof PureFunctionParameterExpr && other.index === this.index;
  }

  override isConstant(): boolean {
    return true;
  }

  override transformInternalExpressions(): void {}

  override clone(): PureFunctionParameterExpr {
    return new PureFunctionParameterExpr(this.index);
  }
}

export class PipeBindingExpr extends ExpressionBase implements UsesSlotIndexTrait,
                                                               ConsumesVarsTrait,
                                                               UsesVarOffsetTrait {
  override readonly kind = ExpressionKind.PipeBinding;
  readonly[UsesSlotIndex] = true;
  readonly[ConsumesVarsTrait] = true;
  readonly[UsesVarOffset] = true;

  targetSlot: number|null = null;
  varOffset: number|null = null;

  constructor(readonly target: XrefId, readonly name: string, readonly args: o.Expression[]) {
    super();
  }

  override visitExpression(visitor: o.ExpressionVisitor, context: any): void {
    for (const arg of this.args) {
      arg.visitExpression(visitor, context);
    }
  }

  override isEquivalent(): boolean {
    return false;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(transform: ExpressionTransform, flags: VisitorContextFlag):
      void {
    for (let idx = 0; idx < this.args.length; idx++) {
      this.args[idx] = transformExpressionsInExpression(this.args[idx], transform, flags);
    }
  }

  override clone() {
    const r = new PipeBindingExpr(this.target, this.name, this.args.map(a => a.clone()));
    r.targetSlot = this.targetSlot;
    r.varOffset = this.varOffset;
    return r;
  }
}

export class PipeBindingVariadicExpr extends ExpressionBase implements UsesSlotIndexTrait,
                                                                       ConsumesVarsTrait,
                                                                       UsesVarOffsetTrait {
  override readonly kind = ExpressionKind.PipeBindingVariadic;
  readonly[UsesSlotIndex] = true;
  readonly[ConsumesVarsTrait] = true;
  readonly[UsesVarOffset] = true;

  targetSlot: number|null = null;
  varOffset: number|null = null;

  constructor(
      readonly target: XrefId, readonly name: string, public args: o.Expression,
      public numArgs: number) {
    super();
  }

  override visitExpression(visitor: o.ExpressionVisitor, context: any): void {
    this.args.visitExpression(visitor, context);
  }

  override isEquivalent(): boolean {
    return false;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(transform: ExpressionTransform, flags: VisitorContextFlag):
      void {
    this.args = transformExpressionsInExpression(this.args, transform, flags);
  }

  override clone(): PipeBindingVariadicExpr {
    const r = new PipeBindingVariadicExpr(this.target, this.name, this.args.clone(), this.numArgs);
    r.targetSlot = this.targetSlot;
    r.varOffset = this.varOffset;
    return r;
  }
}

export class SafePropertyReadExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.SafePropertyRead;

  constructor(public receiver: o.Expression, public name: string) {
    super();
  }

  // An alias for name, which allows other logic to handle property reads and keyed reads together.
  get index() {
    return this.name;
  }

  override visitExpression(visitor: o.ExpressionVisitor, context: any): any {
    this.receiver.visitExpression(visitor, context);
  }

  override isEquivalent(): boolean {
    return false;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(transform: ExpressionTransform, flags: VisitorContextFlag):
      void {
    this.receiver = transformExpressionsInExpression(this.receiver, transform, flags);
  }

  override clone(): SafePropertyReadExpr {
    return new SafePropertyReadExpr(this.receiver.clone(), this.name);
  }
}

export class SafeKeyedReadExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.SafeKeyedRead;

  constructor(
      public receiver: o.Expression, public index: o.Expression, sourceSpan: ParseSourceSpan|null) {
    super(sourceSpan);
  }

  override visitExpression(visitor: o.ExpressionVisitor, context: any): any {
    this.receiver.visitExpression(visitor, context);
    this.index.visitExpression(visitor, context);
  }

  override isEquivalent(): boolean {
    return false;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(transform: ExpressionTransform, flags: VisitorContextFlag):
      void {
    this.receiver = transformExpressionsInExpression(this.receiver, transform, flags);
    this.index = transformExpressionsInExpression(this.index, transform, flags);
  }

  override clone(): SafeKeyedReadExpr {
    return new SafeKeyedReadExpr(this.receiver.clone(), this.index.clone(), this.sourceSpan);
  }
}

export class SafeInvokeFunctionExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.SafeInvokeFunction;

  constructor(public receiver: o.Expression, public args: o.Expression[]) {
    super();
  }

  override visitExpression(visitor: o.ExpressionVisitor, context: any): any {
    this.receiver.visitExpression(visitor, context);
    for (const a of this.args) {
      a.visitExpression(visitor, context);
    }
  }

  override isEquivalent(): boolean {
    return false;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(transform: ExpressionTransform, flags: VisitorContextFlag):
      void {
    this.receiver = transformExpressionsInExpression(this.receiver, transform, flags);
    for (let i = 0; i < this.args.length; i++) {
      this.args[i] = transformExpressionsInExpression(this.args[i], transform, flags);
    }
  }

  override clone(): SafeInvokeFunctionExpr {
    return new SafeInvokeFunctionExpr(this.receiver.clone(), this.args.map(a => a.clone()));
  }
}

export class SafeTernaryExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.SafeTernaryExpr;

  constructor(public guard: o.Expression, public expr: o.Expression) {
    super();
  }

  override visitExpression(visitor: o.ExpressionVisitor, context: any): any {
    this.guard.visitExpression(visitor, context);
    this.expr.visitExpression(visitor, context);
  }

  override isEquivalent(): boolean {
    return false;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(transform: ExpressionTransform, flags: VisitorContextFlag):
      void {
    this.guard = transformExpressionsInExpression(this.guard, transform, flags);
    this.expr = transformExpressionsInExpression(this.expr, transform, flags);
  }

  override clone(): SafeTernaryExpr {
    return new SafeTernaryExpr(this.guard.clone(), this.expr.clone());
  }
}

export class EmptyExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.EmptyExpr;

  override visitExpression(visitor: o.ExpressionVisitor, context: any): any {}

  override isEquivalent(e: Expression): boolean {
    return e instanceof EmptyExpr;
  }

  override isConstant() {
    return true;
  }

  override clone(): EmptyExpr {
    return new EmptyExpr();
  }

  override transformInternalExpressions(): void {}
}

export class AssignTemporaryExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.AssignTemporaryExpr;

  public name: string|null = null;

  constructor(public expr: o.Expression, public xref: XrefId) {
    super();
  }

  override visitExpression(visitor: o.ExpressionVisitor, context: any): any {
    this.expr.visitExpression(visitor, context);
  }

  override isEquivalent(): boolean {
    return false;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(transform: ExpressionTransform, flags: VisitorContextFlag):
      void {
    this.expr = transformExpressionsInExpression(this.expr, transform, flags);
  }

  override clone(): AssignTemporaryExpr {
    const a = new AssignTemporaryExpr(this.expr.clone(), this.xref);
    a.name = this.name;
    return a;
  }
}

export class ReadTemporaryExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.ReadTemporaryExpr;

  public name: string|null = null;

  constructor(public xref: XrefId) {
    super();
  }

  override visitExpression(visitor: o.ExpressionVisitor, context: any): any {}

  override isEquivalent(): boolean {
    return this.xref === this.xref;
  }

  override isConstant(): boolean {
    return false;
  }

  override transformInternalExpressions(transform: ExpressionTransform, flags: VisitorContextFlag):
      void {}

  override clone(): ReadTemporaryExpr {
    const r = new ReadTemporaryExpr(this.xref);
    r.name = this.name;
    return r;
  }
}

export class SanitizerExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.SanitizerExpr;

  constructor(public fn: SanitizerFn) {
    super();
  }

  override visitExpression(visitor: o.ExpressionVisitor, context: any): any {}

  override isEquivalent(e: Expression): boolean {
    return e instanceof SanitizerExpr && e.fn === this.fn;
  }

  override isConstant() {
    return true;
  }

  override clone(): SanitizerExpr {
    return new SanitizerExpr(this.fn);
  }

  override transformInternalExpressions(): void {}
}

export class SlotLiteralExpr extends ExpressionBase implements UsesSlotIndexTrait {
  override readonly kind = ExpressionKind.SlotLiteralExpr;
  readonly[UsesSlotIndex] = true;

  constructor(readonly target: XrefId) {
    super();
  }

  targetSlot: number|null = null;

  override visitExpression(visitor: o.ExpressionVisitor, context: any): any {}

  override isEquivalent(e: Expression): boolean {
    return e instanceof SlotLiteralExpr && e.target === this.target &&
        e.targetSlot === this.targetSlot;
  }

  override isConstant() {
    return true;
  }

  override clone(): SlotLiteralExpr {
    const copy = new SlotLiteralExpr(this.target);
    copy.targetSlot = this.targetSlot;
    return copy;
  }

  override transformInternalExpressions(): void {}
}

export class ConditionalCaseExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.ConditionalCase;

  /**
   * Create an expression for one branch of a conditional.
   * @param expr The expression to be tested for this case. Might be null, as in an `else` case.
   * @param target The Xref of the view to be displayed if this condition is true.
   */
  constructor(
      public expr: o.Expression|null, readonly target: XrefId,
      readonly alias: t.Variable|null = null) {
    super();
  }

  override visitExpression(visitor: o.ExpressionVisitor, context: any): any {
    if (this.expr !== null) {
      this.expr.visitExpression(visitor, context);
    }
  }

  override isEquivalent(e: Expression): boolean {
    return e instanceof ConditionalCaseExpr && e.expr === this.expr;
  }

  override isConstant() {
    return true;
  }

  override clone(): ConditionalCaseExpr {
    return new ConditionalCaseExpr(this.expr, this.target);
  }

  override transformInternalExpressions(transform: ExpressionTransform, flags: VisitorContextFlag):
      void {
    if (this.expr !== null) {
      this.expr = transformExpressionsInExpression(this.expr, transform, flags);
    }
  }
}

export enum DerivedRepeaterVarIdentity {
  First,
  Last,
  Even,
  Odd,
}

export class DerivedRepeaterVarExpr extends ExpressionBase {
  override readonly kind = ExpressionKind.DerivedRepeaterVar;

  constructor(readonly xref: XrefId, readonly identity: DerivedRepeaterVarIdentity) {
    super();
  }

  override transformInternalExpressions(transform: ExpressionTransform, flags: VisitorContextFlag):
      void {}

  override visitExpression(visitor: o.ExpressionVisitor, context: any) {}

  override isEquivalent(e: o.Expression): boolean {
    return e instanceof DerivedRepeaterVarExpr && e.identity === this.identity &&
        e.xref === this.xref;
  }

  override isConstant(): boolean {
    return false;
  }

  override clone(): o.Expression {
    return new DerivedRepeaterVarExpr(this.xref, this.identity);
  }
}

/**
 * Visits all `Expression`s in the AST of `op` with the `visitor` function.
 */
export function visitExpressionsInOp(
    op: CreateOp|UpdateOp, visitor: (expr: o.Expression, flags: VisitorContextFlag) => void): void {
  transformExpressionsInOp(op, (expr, flags) => {
    visitor(expr, flags);
    return expr;
  }, VisitorContextFlag.None);
}

export enum VisitorContextFlag {
  None = 0b0000,
  InChildOperation = 0b0001,
}

function transformExpressionsInInterpolation(
    interpolation: Interpolation, transform: ExpressionTransform, flags: VisitorContextFlag) {
  for (let i = 0; i < interpolation.expressions.length; i++) {
    interpolation.expressions[i] =
        transformExpressionsInExpression(interpolation.expressions[i], transform, flags);
  }
}

/**
 * Transform all `Expression`s in the AST of `op` with the `transform` function.
 *
 * All such operations will be replaced with the result of applying `transform`, which may be an
 * identity transformation.
 */
export function transformExpressionsInOp(
    op: CreateOp|UpdateOp, transform: ExpressionTransform, flags: VisitorContextFlag): void {
  switch (op.kind) {
    case OpKind.StyleProp:
    case OpKind.StyleMap:
    case OpKind.ClassProp:
    case OpKind.ClassMap:
    case OpKind.Binding:
    case OpKind.HostProperty:
      if (op.expression instanceof Interpolation) {
        transformExpressionsInInterpolation(op.expression, transform, flags);
      } else {
        op.expression = transformExpressionsInExpression(op.expression, transform, flags);
      }
      break;
    case OpKind.Property:
    case OpKind.Attribute:
      if (op.expression instanceof Interpolation) {
        transformExpressionsInInterpolation(op.expression, transform, flags);
      } else {
        op.expression = transformExpressionsInExpression(op.expression, transform, flags);
      }
      op.sanitizer =
          op.sanitizer && transformExpressionsInExpression(op.sanitizer, transform, flags);
      break;
    case OpKind.I18nExpression:
      op.expression = transformExpressionsInExpression(op.expression, transform, flags);
      break;
    case OpKind.InterpolateText:
      transformExpressionsInInterpolation(op.interpolation, transform, flags);
      break;
    case OpKind.Statement:
      transformExpressionsInStatement(op.statement, transform, flags);
      break;
    case OpKind.Variable:
      op.initializer = transformExpressionsInExpression(op.initializer, transform, flags);
      break;
    case OpKind.Conditional:
      for (const condition of op.conditions) {
        if (condition.expr === null) {
          // This is a default case.
          continue;
        }
        condition.expr = transformExpressionsInExpression(condition.expr, transform, flags);
      }
      if (op.processed !== null) {
        op.processed = transformExpressionsInExpression(op.processed, transform, flags);
      }
      if (op.contextValue !== null) {
        op.contextValue = transformExpressionsInExpression(op.contextValue, transform, flags);
      }
      break;
    case OpKind.Listener:
      for (const innerOp of op.handlerOps) {
        transformExpressionsInOp(innerOp, transform, flags | VisitorContextFlag.InChildOperation);
      }
      break;
    case OpKind.ExtractedAttribute:
      op.expression =
          op.expression && transformExpressionsInExpression(op.expression, transform, flags);
      break;
    case OpKind.RepeaterCreate:
      op.track = transformExpressionsInExpression(op.track, transform, flags);
      if (op.trackByFn !== null) {
        op.trackByFn = transformExpressionsInExpression(op.trackByFn, transform, flags);
      }
      break;
    case OpKind.Repeater:
      op.collection = transformExpressionsInExpression(op.collection, transform, flags);
      break;
    case OpKind.Advance:
    case OpKind.Container:
    case OpKind.ContainerEnd:
    case OpKind.ContainerStart:
    case OpKind.Defer:
    case OpKind.DeferOn:
    case OpKind.DeferSecondaryBlock:
    case OpKind.DisableBindings:
    case OpKind.Element:
    case OpKind.ElementEnd:
    case OpKind.ElementStart:
    case OpKind.EnableBindings:
    case OpKind.ExtractedMessage:
    case OpKind.I18n:
    case OpKind.I18nApply:
    case OpKind.I18nEnd:
    case OpKind.I18nStart:
    case OpKind.Icu:
    case OpKind.IcuUpdate:
    case OpKind.Namespace:
    case OpKind.Pipe:
    case OpKind.Projection:
    case OpKind.ProjectionDef:
    case OpKind.Template:
    case OpKind.Text:
      // These operations contain no expressions.
      break;
    default:
      throw new Error(`AssertionError: transformExpressionsInOp doesn't handle ${OpKind[op.kind]}`);
  }
}

/**
 * Transform all `Expression`s in the AST of `expr` with the `transform` function.
 *
 * All such operations will be replaced with the result of applying `transform`, which may be an
 * identity transformation.
 */
export function transformExpressionsInExpression(
    expr: o.Expression, transform: ExpressionTransform, flags: VisitorContextFlag): o.Expression {
  if (expr instanceof ExpressionBase) {
    expr.transformInternalExpressions(transform, flags);
  } else if (expr instanceof o.BinaryOperatorExpr) {
    expr.lhs = transformExpressionsInExpression(expr.lhs, transform, flags);
    expr.rhs = transformExpressionsInExpression(expr.rhs, transform, flags);
  } else if (expr instanceof o.ReadPropExpr) {
    expr.receiver = transformExpressionsInExpression(expr.receiver, transform, flags);
  } else if (expr instanceof o.ReadKeyExpr) {
    expr.receiver = transformExpressionsInExpression(expr.receiver, transform, flags);
    expr.index = transformExpressionsInExpression(expr.index, transform, flags);
  } else if (expr instanceof o.WritePropExpr) {
    expr.receiver = transformExpressionsInExpression(expr.receiver, transform, flags);
    expr.value = transformExpressionsInExpression(expr.value, transform, flags);
  } else if (expr instanceof o.WriteKeyExpr) {
    expr.receiver = transformExpressionsInExpression(expr.receiver, transform, flags);
    expr.index = transformExpressionsInExpression(expr.index, transform, flags);
    expr.value = transformExpressionsInExpression(expr.value, transform, flags);
  } else if (expr instanceof o.InvokeFunctionExpr) {
    expr.fn = transformExpressionsInExpression(expr.fn, transform, flags);
    for (let i = 0; i < expr.args.length; i++) {
      expr.args[i] = transformExpressionsInExpression(expr.args[i], transform, flags);
    }
  } else if (expr instanceof o.LiteralArrayExpr) {
    for (let i = 0; i < expr.entries.length; i++) {
      expr.entries[i] = transformExpressionsInExpression(expr.entries[i], transform, flags);
    }
  } else if (expr instanceof o.LiteralMapExpr) {
    for (let i = 0; i < expr.entries.length; i++) {
      expr.entries[i].value =
          transformExpressionsInExpression(expr.entries[i].value, transform, flags);
    }
  } else if (expr instanceof o.ConditionalExpr) {
    expr.condition = transformExpressionsInExpression(expr.condition, transform, flags);
    expr.trueCase = transformExpressionsInExpression(expr.trueCase, transform, flags);
    if (expr.falseCase !== null) {
      expr.falseCase = transformExpressionsInExpression(expr.falseCase, transform, flags);
    }
  } else if (expr instanceof o.TypeofExpr) {
    expr.expr = transformExpressionsInExpression(expr.expr, transform, flags);
  } else if (expr instanceof o.WriteVarExpr) {
    expr.value = transformExpressionsInExpression(expr.value, transform, flags);
  } else if (expr instanceof o.LocalizedString) {
    for (let i = 0; i < expr.expressions.length; i++) {
      expr.expressions[i] = transformExpressionsInExpression(expr.expressions[i], transform, flags);
    }
  } else if (
      expr instanceof o.ReadVarExpr || expr instanceof o.ExternalExpr ||
      expr instanceof o.LiteralExpr) {
    // No action for these types.
  } else {
    throw new Error(`Unhandled expression kind: ${expr.constructor.name}`);
  }
  return transform(expr, flags);
}

/**
 * Transform all `Expression`s in the AST of `stmt` with the `transform` function.
 *
 * All such operations will be replaced with the result of applying `transform`, which may be an
 * identity transformation.
 */
export function transformExpressionsInStatement(
    stmt: o.Statement, transform: ExpressionTransform, flags: VisitorContextFlag): void {
  if (stmt instanceof o.ExpressionStatement) {
    stmt.expr = transformExpressionsInExpression(stmt.expr, transform, flags);
  } else if (stmt instanceof o.ReturnStatement) {
    stmt.value = transformExpressionsInExpression(stmt.value, transform, flags);
  } else if (stmt instanceof o.DeclareVarStmt) {
    if (stmt.value !== undefined) {
      stmt.value = transformExpressionsInExpression(stmt.value, transform, flags);
    }
  } else if (stmt instanceof o.IfStmt) {
    stmt.condition = transformExpressionsInExpression(stmt.condition, transform, flags);
    for (const caseStatement of stmt.trueCase) {
      transformExpressionsInStatement(caseStatement, transform, flags);
    }
    for (const caseStatement of stmt.falseCase) {
      transformExpressionsInStatement(caseStatement, transform, flags);
    }
  } else {
    throw new Error(`Unhandled statement kind: ${stmt.constructor.name}`);
  }
}

/**
 * Checks whether the given expression is a string literal.
 */
export function isStringLiteral(expr: o.Expression): expr is o.LiteralExpr&{value: string} {
  return expr instanceof o.LiteralExpr && typeof expr.value === 'string';
}

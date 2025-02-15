/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { AstNode, Properties } from '../../src';
import type { Assignment, CrossReference, ParserRule, UnionType } from '../../src/grammar/generated/ast';
import type { ValidationResult } from '../../src/test';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { createLangiumGrammarServices, EmptyFileSystem, GrammarAST, streamAllContents, streamContents } from '../../src';
import { isAssignment } from '../../src/grammar/generated/ast';
import { IssueCodes } from '../../src/grammar/validation/validator';
import { clearDocuments, expectError, expectIssue, expectNoIssues, expectWarning, parseHelper, validationHelper } from '../../src/test';

const services = createLangiumGrammarServices(EmptyFileSystem);
const parse = parseHelper(services.grammar);
const locator = services.grammar.workspace.AstNodeLocator;
const validate = validationHelper<GrammarAST.Grammar>(services.grammar);

describe('Langium grammar validation', () => {

    test('Declared interfaces warn when extending inferred interfaces', async () => {
        const validationResult = await validate(`
        InferredT: prop=ID;

        interface DeclaredExtendsInferred extends InferredT {}`);

        // should get a warning when basing declared types on inferred types
        expectError(validationResult, /Extending an inferred type is discouraged./, {
            node: validationResult.document.parseResult.value.interfaces[0],
            property: 'superTypes'
        });
    });

    test('Parser rule should not assign fragments', async () => {
        // arrange
        const grammarText = `
        grammar Test
        entry A: b=B;
        fragment B: name=ID;
        terminal ID returns string: /[a-z]+/;
        `;

        // act
        const validationResult = await validate(grammarText);

        // assert
        expectError(validationResult, /Cannot use fragment rule 'B' for assignment of property 'b'./, {
            node: (validationResult.document.parseResult.value.rules[0] as GrammarAST.ParserRule).definition as GrammarAST.Assignment,
            property: 'terminal'
        });
    });

    test('Declared interfaces cannot extend inferred unions directly', async () => {
        const validationResult = await validate(`
        InferredUnion: InferredI1 | InferredI2;

        InferredI1: prop1=ID;
        InferredI2: prop2=ID;

        interface DeclaredExtendsUnion extends InferredUnion {}

        terminal ID returns string: /[a-z]+/;
        `);

        expectError(validationResult, /Interfaces cannot extend union types./, {
            node: validationResult.document.parseResult.value.interfaces[0],
            property: 'superTypes'
        });
        expectError(validationResult, /Extending an inferred type is discouraged./, {
            node: validationResult.document.parseResult.value.interfaces[0],
            property: 'superTypes'
        });
    });

    test('Declared interfaces cannot extend inferred unions via indirect inheritance', async () => {

        const validationResult = await validate(`
        InferredUnion: InferredI1 | InferredI2;

        InferredI1: prop1=ID;
        InferredI2: prop2=ID;

        Intermediary: InferredUnion;

        interface DeclaredExtendsInferred extends Intermediary {}

        terminal ID returns string: /[a-z]+/;
        `);

        expectError(validationResult, /Interfaces cannot extend union types./, {
            node: validationResult.document.parseResult.value.interfaces[0],
            property: 'superTypes'
        });
        expectError(validationResult, /Extending an inferred type is discouraged./, {
            node: validationResult.document.parseResult.value.interfaces[0],
            property: 'superTypes'
        });
    });

    test('Actions cannot redefine declared types', async () => {
        const validationResult = await validate(`
        grammar G
        interface A {
            val: string
        }
        entry X: 'x' {A} val=ID;
        Y: 'y' {infer A} q='broken';
        `);
        expectError(validationResult, /A is a declared type and cannot be redefined./, {
            range: {
                start: { character: 15, line: 6 },
                end: { character: 24, line: 6 }
            },
            code: IssueCodes.SuperfluousInfer
        });
    });

    test('Missing return should be added to parser rule', async () => {
        const validationResult = await validate(`
        grammar G
        interface T { a: string }
        entry T: 't' a=ID;
        terminal ID returns string: /[a-z]+/;
        `);
        expectError(validationResult, /The type 'T' is already explicitly declared and cannot be inferred./, {
            node: validationResult.document.parseResult.value.rules[0],
            property: 'name',
            code: IssueCodes.MissingReturns
        });
    });

    test('Invalid infers should be changed to returns', async () => {
        const validationResult = await validate(`
        grammar G
        interface T { a: string }
        entry T infers T: 't' a=ID;
        terminal ID returns string: /[a-z]+/;
        `);
        expect(validationResult.diagnostics).toHaveLength(1);
        expect(validationResult.diagnostics[0].code).toBe(IssueCodes.InvalidInfers);
    });
});

describe('Data type rule return type', () => {

    test('normal rule + data type return type = error', async () => {
        const validationResult = await validate(`
            ParserRule returns string: name='ParserRule';
        `);
        expectError(validationResult, 'Normal parser rules are not allowed to return a primitive value. Use a datatype rule for that.', {
            node: validationResult.document.parseResult.value.rules[0] as ParserRule,
            property: 'dataType'
        });
    });

    test('data type rule + primitive data type = valid', async () => {
        const validationResult = await validate(`
            ParserRule returns string: 'ParserRule';
        `);
        expectNoIssues(validationResult);
    });

    test('data type rule + complex data type = valid', async () => {
        const validationResult = await validate(`
            ParserRule returns ParserRuleType: 'ParserRule';
            type ParserRuleType = 'ParserRule';
        `);
        expectNoIssues(validationResult);
    });

    test('normal rule + complex data type = error', async () => {
        const validationResult = await validate(`
            ParserRule returns ParserRuleType: name='ParserRule';
            type ParserRuleType = 'ParserRule';
        `);
        expectError(validationResult, 'Normal parser rules are not allowed to return a primitive value. Use a datatype rule for that.', {
            node: validationResult.document.parseResult.value.rules[0] as ParserRule,
            property: 'returnType'
        });
    });

});

describe('checkReferenceToRuleButNotType', () => {

    const input = `
        grammar CrossRefs

        entry Model:
            'model' name=ID
            (elements+=Element)*;

        type AbstractElement = Reference | string;

        Element:
            Definition | Reference;

        Definition infers DefType:
            name=ID;
        Reference infers RefType:
            ref=[Definition];
        terminal ID: /[_a-zA-Z][\\w_]*/;
    `.trim();

    let validationResult: ValidationResult<GrammarAST.Grammar>;

    beforeAll(async () => {
        validationResult = await validate(input);
    });

    test('CrossReference validation', () => {
        const crossRef = streamAllContents(validationResult.document.parseResult.value).find(GrammarAST.isCrossReference)!;
        expectError(validationResult, "Could not resolve reference to AbstractType named 'Definition'.", {
            node: crossRef,
            property: 'type'
        });
    });

    test('AtomType validation', () => {
        const unionType = validationResult.document.parseResult.value.types[0].type as UnionType;
        const missingType = unionType.types[0];
        expectError(validationResult, "Could not resolve reference to AbstractType named 'Reference'.", {
            node: missingType
        });
    });

});

describe('Check Rule Fragment Validation', () => {
    const grammar = `
    grammar g
    type Type = Fragment;
    fragment Fragment: name=ID;
    terminal ID: /[_a-zA-Z][\\w_]*/;
    `.trim();

    let validationResult: ValidationResult<GrammarAST.Grammar>;

    beforeAll(async () => {
        validationResult = await validate(grammar);
    });

    test('Rule Fragment Validation', () => {
        const range = { start: { character: 16, line: 1 }, end: { character: 24, line: 1 } };
        expectError(validationResult, 'Cannot use rule fragments in types.', { range });
    });
});

describe('Checked Named CrossRefs', () => {
    const input = `
    grammar g
    A: 'a' name=ID;
    B: 'b' name=[A];
    terminal ID: /[_a-zA-Z][\\w_]*/;
    `.trim();

    let validationResult: ValidationResult<GrammarAST.Grammar>;

    beforeAll(async () => {
        validationResult = await validate(input);
    });

    test('Named crossReference warning', () => {
        const rule = ((validationResult.document.parseResult.value.rules[1] as GrammarAST.ParserRule).definition as GrammarAST.Group).elements[1] as GrammarAST.Assignment;
        expectWarning(validationResult, 'The "name" property is not recommended for cross-references.', {
            node: rule,
            property: 'feature'
        });
    });
});

describe('Check grammar with primitives', () => {
    const grammar = `
    grammar PrimGrammar
    entry Expr:
        (Word | Bool | Num | LargeInt | DateObj)*;
    Word:
        'Word' val=STR;
    Bool:
        'Bool' val?='true';
    Num:
        'Num' val=NUM;
    LargeInt:
        'LargeInt' val=BIG 'n';
    DateObj:
        'Date' val=DATE;
    terminal STR: /[_a-zA-Z][\\w_]*/;
    terminal BIG returns bigint: /[0-9]+(?=n)/;
    terminal NUM returns number: /[0-9]+(\\.[0-9])?/;
    terminal DATE returns Date: /[0-9]{4}-{0-9}2-{0-9}2/+;
    `.trim();

    let validationResult: ValidationResult<GrammarAST.Grammar>;

    // 1. build a parser from this grammar, verify it works
    beforeAll(async () => {
        validationResult = await validate(grammar);
    });

    test('No validation errors in grammar', () => {
        expectNoIssues(validationResult);
    });
});

describe('Unordered group validations', () => {

    test('Unsupported optional element in unordered group error', async () => {
        const text = `
        grammar TestUnorderedGroup

        entry Book:
            'book' name=STRING
            (
                  ("description" descr=STRING)
                & ("edition" version=STRING)?
                & ("author" author=STRING)
            )
        ;
        hidden terminal WS: /\\s+/;
        terminal STRING: /"[^"]*"|'[^']*'/;
        `;

        const validation = await validate(text);
        expect(validation.diagnostics).toHaveLength(1);
        const errorText = '("edition" version=STRING)?';
        const offset = validation.document.textDocument.getText().indexOf(errorText);
        expectError(validation, 'Optional elements in Unordered groups are currently not supported', { offset: offset, length: errorText.length, code: IssueCodes.OptionalUnorderedGroup });
    });
});

describe('Unused rules validation', () => {

    test('Should not create validate for indirectly used terminal', async () => {
        const text = `
        grammar TestUsedTerminals

        entry Used: name=ID;
        hidden terminal WS: /\\s+/;
        terminal ID: 'a' STRING;
        terminal STRING: /"[^"]*"|'[^']*'/;
        `;
        const validation = await validate(text);
        expectNoIssues(validation);
    });

    test('Unused terminals are correctly identified', async () => {
        const text = `
        grammar TestUnusedTerminals

        entry Used: name=ID;
        hidden terminal WS: /\\s+/;
        terminal ID: /[_a-zA-Z][\\w_]*/;
        terminal STRING: /"[^"]*"|'[^']*'/;
        `;
        const validation = await validate(text);
        expect(validation.diagnostics).toHaveLength(1);
        const stringTerminal = validation.document.parseResult.value.rules.find(e => e.name === 'STRING')!;
        expectIssue(validation, {
            node: stringTerminal,
            property: 'name',
            severity: DiagnosticSeverity.Hint
        });
    });

    test('Unused parser rules are correctly identified', async () => {
        const text = `
        grammar TestUnusedParserRule

        entry Used: name=ID;
        Unused: name=ID;
        hidden terminal WS: /\\s+/;
        terminal ID: /[_a-zA-Z][\\w_]*/;
        `;
        const validation = await validate(text);
        expect(validation.diagnostics).toHaveLength(1);
        const unusedRule = validation.document.parseResult.value.rules.find(e => e.name === 'Unused')!;
        expectIssue(validation, {
            node: unusedRule,
            property: 'name',
            severity: DiagnosticSeverity.Hint
        });
    });

});

describe('Reserved names', () => {

    test('Reserved parser rule name', async () => {
        const text = 'String: name="X";';
        expectReservedName(await validate(text), GrammarAST.isParserRule, 'name');
    });

    test('Reserved terminal rule name - negative', async () => {
        const text = 'terminal String: /X/;';
        const validation = await validate(text);
        expect(validation.diagnostics).toHaveLength(0);
    });

    test('Reserved rule inferred type', async () => {
        const text = 'X infers String: name="X";';
        expectReservedName(await validate(text), GrammarAST.isInferredType, 'name');
    });

    test('Reserved assignment feature', async () => {
        const text = 'X: Map="X";';
        expectReservedName(await validate(text), GrammarAST.isAssignment, 'feature');
    });

    test('Reserved action type', async () => {
        const text = 'X: {infer String} name="X";';
        expectReservedName(await validate(text), GrammarAST.isInferredType, 'name');
    });

    test('Reserved action feature', async () => {
        const text = 'X: Y {infer Z.Map=current} name="X"; Y: name="Y";';
        expectReservedName(await validate(text), GrammarAST.isAction, 'feature');
    });

    test('Reserved interface name', async () => {
        const text = 'interface String {}';
        expectReservedName(await validate(text), GrammarAST.isInterface, 'name');
    });

    test('Reserved interface name - negative', async () => {
        const text = 'interface obj {}';
        const validation = await validate(text);
        expect(validation.diagnostics).toHaveLength(0);
    });

    test('Reserved type attribute name', async () => {
        const text = 'interface X { Map: number }';
        expectReservedName(await validate(text), GrammarAST.isTypeAttribute, 'name');
    });

    test('Reserved type name', async () => {
        const text = 'type String = X; X: name="X";';
        expectReservedName(await validate(text), GrammarAST.isType, 'name');
    });

    function expectReservedName<T extends AstNode>(validation: ValidationResult<GrammarAST.Grammar>, predicate: (node: AstNode) => node is T, property: Properties<T>): void {
        expect(validation.diagnostics).toHaveLength(1);
        const node = streamAllContents(validation.document.parseResult.value).find(predicate)!;
        expectIssue(validation, {
            node,
            message: / is a reserved name of the JavaScript runtime\.$/,
            property,
            severity: DiagnosticSeverity.Error
        });
    }

});

describe('Whitespace keywords', () => {

    const grammar = `
    ParserRule: name='x' ' ' '' 'x y';
    terminal TerminalRule: ' ' | 'x';
    terminal STR: /[_a-zA-Z][\\w_]*/;
    `.trim();

    let validationResult: ValidationResult<GrammarAST.Grammar>;

    // 1. build a parser from this grammar, verify it works
    beforeAll(async () => {
        validationResult = await validate(grammar);
    });

    test('No validation errors for whitespace keywords in terminal rule', () => {
        const node = locator.getAstNode<GrammarAST.Keyword>(
            validationResult.document.parseResult.value,
            'rules@1/definition/elements@1'
        )!;
        expectNoIssues(validationResult, { node });
    });

    test('Should error for whitespace keyword in parser rule', () => {
        const node = locator.getAstNode<GrammarAST.Keyword>(
            validationResult.document.parseResult.value,
            'rules@0/definition/elements@1'
        )!;
        expectError(validationResult, 'Keywords cannot only consist of whitespace characters.', { node });
    });

    test('Should error for empty keyword in parser rule', () => {
        const node = locator.getAstNode<GrammarAST.Keyword>(
            validationResult.document.parseResult.value,
            'rules@0/definition/elements@2'
        )!;
        expectError(validationResult, 'Keywords cannot be empty.', { node });
    });

    test('Should warn for keywords with whitespaces in parser rule', () => {
        const node = locator.getAstNode<GrammarAST.Keyword>(
            validationResult.document.parseResult.value,
            'rules@0/definition/elements@3'
        )!;
        expectWarning(validationResult, 'Keywords should not contain whitespace characters.', { node });
    });

});

describe('Clashing token names', () => {

    afterEach(() => {
        clearDocuments(services.grammar);
    });

    test('Local terminal clashing with local keyword', async () => {
        const text = `
        Rule: a='a';
        terminal a: /a/;
        `;
        const validation = await validate(text);
        const terminal = locator.getAstNode(validation.document.parseResult.value, '/rules@1')!;
        expectError(validation, 'Terminal name clashes with existing keyword.', {
            node: terminal,
            property: 'name'
        });
    });

    test('Local terminal clashing with imported keyword', async () => {
        const importedGrammar = await parse(`
        Rule: a='a';
        `);
        const path = importedGrammar.uri.path;
        const grammar = `
        import ".${path}";
        terminal a: /a/;
        `;
        const validation = await validate(grammar);
        const terminal = locator.getAstNode(validation.document.parseResult.value, '/rules@0')!;
        expectError(validation, /Terminal name clashes with imported keyword from/, {
            node: terminal,
            property: 'name'
        });
    });

    test('Imported terminal clashing with local keyword', async () => {
        const importedGrammar = await parse(`
        terminal a: /a/;
        `);
        const path = importedGrammar.uri.path;
        const grammar = `
        import ".${path}";
        Rule: a='a';
        `;
        const validation = await validate(grammar);
        const importNode = validation.document.parseResult.value.imports[0];
        expectError(validation, 'Imported terminals (a) clash with locally defined keywords.', {
            node: importNode,
            property: 'path'
        });
    });

    test('Imported terminal clashing with imported keywords', async () => {
        const importedTerminal = await parse(`
        terminal a: /a/;
        `);
        const importedKeyword = await parse(`
        Rule: a='a';
        `);
        const terminalPath = importedTerminal.uri.path;
        const keywordPath = importedKeyword.uri.path;
        const grammar = `
        import ".${terminalPath}";
        import ".${keywordPath}";
        Test: x='x';
        `;
        const validation = await validate(grammar);
        const importNode = validation.document.parseResult.value.imports[0];
        expectError(validation, 'Imported terminals (a) clash with imported keywords.', {
            node: importNode,
            property: 'path'
        });
    });

    test('Imported terminal not clashing with transitive imported keywords', async () => {
        const importedGrammar = await parse(`
        Rule: a='a';
        terminal a: /a/;
        `);
        let path = importedGrammar.uri.path;
        // remove '.langium' extension
        path = path.substring(0, path.indexOf('.'));
        const grammar = `
        import ".${path}";
        Test: x='x';
        `;
        const validation = await validate(grammar);
        expectNoIssues(validation);
    });
});

describe('Property type is not a mix of cross-ref and non-cross-ref types.', () => {

    test('Parser rule property not mixed.', async () => {
        const validation = await validate(`
        Rule:
            name = 'string'
        ;
        Rule1:
            prop = [Rule]
        ;
        Rule2:
            prop = Rule
        ;
        Rule3:
            prop = ('string' | Rule)
        ;
        `);
        expectNoIssues(validation);
    });

    test('Parser rule property mixed.', async () => {
        const validation = await validate(`
        Rule:
            name = 'string'
        ;
        Rule1:
            prop = ('string' | [Rule])
        ;
        `);
        const rule1Assignment = streamContents(validation.document.parseResult.value.rules[1])
            .filter(node => isAssignment(node)).head() as Assignment;
        expect(rule1Assignment).not.toBe(undefined);

        expectError(validation, /Mixing a cross-reference with other types is not supported. Consider splitting property /, {
            node: rule1Assignment!,
            property: 'terminal'
        });
    });
    test('Parser rule property complex mixed.', async () => {
        const validation = await validate(`
        Rule:
            name = 'string'
        ;
        Rule1:
            prop = ('int' | ('string' | [Rule]))
        ;
        `);
        const rule1Assignment = streamContents(validation.document.parseResult.value.rules[1])
            .filter(node => isAssignment(node)).head() as Assignment;
        expect(rule1Assignment).not.toBe(undefined);

        expectError(validation, /Mixing a cross-reference with other types is not supported. Consider splitting property /, {
            node: rule1Assignment!,
            property: 'terminal'
        });
    });

});

describe('Missing required properties are not arrays or booleans', () => {

    test('No missing properties', async () => {
        const validation = await validate(`
        interface A {
            name: string;
        }
        A returns A:
            name = 'string'
        ;
        `);
        expectNoIssues(validation);
    });

    test.each(['number[]', 'boolean'])('Missing mandatory %s properties', async (type) => {
        const validation = await validate(`
        interface A {
            name: string;
            values: ${type};
        }
        A returns A:
            name = 'string'
        ;
        `);
        expectNoIssues(validation);
    });

    test.each(['string', 'number', 'bigint'])('Missing non-mandatory %s properties', async (type) => {
        const validation = await validate(`
        interface A {
            name: string;
            value: ${type};
        }
        A returns A:
            name = 'string'
        ;
        `);
        const rule = validation.document.parseResult.value.rules[0];
        expectError(validation, /A property 'value' is expected. /, {
            node: rule,
            property: 'name'
        });
    });

});

describe('Cross-reference to type union is only valid if all alternatives are AST nodes.', () => {
    afterEach(() => {
        clearDocuments(services.grammar);
    });

    test('Should not return error on union type composed only of AST nodes', async () => {
        const validationResult = await validate(`
        A: 'A' name=ID;
        B: 'B' name=ID;
        type T = A | B;
        R: a=[T];

        terminal ID returns string: /[a-z]+/;
        `);
        expectNoIssues(validationResult);
    });

    test('Should return validation error on union type containing a primitive', async () => {
        const validationResult = await validate(`
        A: 'A' name=ID;
        type B = 'B';
        type T = A | B;
        R: a=[T];

        terminal ID returns string: /[a-z]+/;
        `);
        const rule = validationResult.document.parseResult.value.rules[1] as ParserRule;
        const reference = ((rule.definition as Assignment).terminal as Assignment).terminal as CrossReference;
        expectError(
            validationResult,
            /Cross-reference on type union is only valid if all alternatives are AST nodes. B is not an AST node./,
            {
                node: reference,
                property: 'type'
            }
        );
    });

    test('Should return validation error on union type containing nested primitives', async () => {
        const validationResult = await validate(`
        A: 'A' name=ID;
        B: 'B' name=ID;
        type C = 'C';
        type D = B | C;
        type T = A | D;
        R: a=[T];

        terminal ID returns string: /[a-z]+/;
        `);
        const rule = validationResult.document.parseResult.value.rules[2] as ParserRule;
        const reference = ((rule.definition as Assignment).terminal as Assignment).terminal as CrossReference;
        expectError(
            validationResult,
            /Cross-reference on type union is only valid if all alternatives are AST nodes. C is not an AST node./,
            {
                node: reference,
                property: 'type'
            }
        );
    });

    test('Should return validation error on union type containing several non-AST nodes', async () => {
        const validationResult = await validate(`
        type A = 'A';
        type T = A | "foo"";
        R: a=[T];

        terminal ID returns string: /[a-z]+/;
        `);
        const rule = validationResult.document.parseResult.value.rules[0] as ParserRule;
        const reference = ((rule.definition as Assignment).terminal as Assignment).terminal as CrossReference;
        expectError(
            validationResult,
            /Cross-reference on type union is only valid if all alternatives are AST nodes. A, "foo" are not AST nodes./,
            {
                node: reference,
                property: 'type'
            }
        );
    });
});

describe('Missing required properties', () => {
    test('No missing properties', async () => {
        const validation = await validate(`
        interface A {
            a: string;
        }
        interface C extends A {}
        A returns A: B | C;
        B returns A: a='foo';
        C returns A: {C} a='bar';
        `);
        expectNoIssues(validation);
    });
});

/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { ImplementationParams, LocationLink } from 'vscode-languageserver';
import type { GrammarConfig } from '../grammar/grammar-config';
import type { References } from '../references/references';
import type { LangiumServices } from '../services';
import type { AstNode } from '../syntax-tree';
import type { MaybePromise } from '../utils/promise-util';
import type { LangiumDocument } from '../workspace/documents';
import { CancellationToken } from 'vscode-languageserver';
import { findDeclarationNodeAtOffset } from '../utils/cst-util';

/**
 * Language-specific service for handling go to implementation requests.
 */
export interface ImplementationProvider {
    /**
     * Handles a go to implementation request.
     */
    getImplementation(document: LangiumDocument, params: ImplementationParams, cancelToken?: CancellationToken): MaybePromise<LocationLink[] | undefined>;
}

export abstract class AbstractGoToImplementationProvider implements ImplementationProvider {
    protected readonly references: References;
    protected readonly grammarConfig: GrammarConfig;

    constructor(services: LangiumServices) {
        this.references = services.references.References;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    getImplementation(document: LangiumDocument<AstNode>, params: ImplementationParams, cancelToken = CancellationToken.None): MaybePromise<LocationLink[] | undefined> {
        const rootNode = document.parseResult.value;
        if (rootNode.$cstNode) {
            const sourceCstNode = findDeclarationNodeAtOffset(rootNode.$cstNode, document.textDocument.offsetAt(params.position), this.grammarConfig.nameRegexp);
            if (sourceCstNode) {
                const nodeDeclaration = this.references.findDeclaration(sourceCstNode);
                if (nodeDeclaration) {
                    return this.collectGoToImplementationLocationLinks(nodeDeclaration, cancelToken);
                }
            }
        }
        return undefined;
    }

    abstract collectGoToImplementationLocationLinks(element: AstNode, cancelToken: CancellationToken): MaybePromise<LocationLink[] | undefined>;
}

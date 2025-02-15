/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { LangiumServices } from '../services';
import type { AstNode, CstNode, GenericAstNode } from '../syntax-tree';
import type { Stream } from '../utils/stream';
import type { ReferenceDescription } from '../workspace/ast-descriptions';
import type { AstNodeLocator } from '../workspace/ast-node-locator';
import type { IndexManager } from '../workspace/index-manager';
import type { NameProvider } from './name-provider';
import type { URI } from 'vscode-uri';
import { findAssignment } from '../utils/grammar-util';
import { isReference } from '../syntax-tree';
import { getDocument } from '../utils/ast-util';
import { isCstChildNode, toDocumentSegment } from '../utils/cst-util';
import { stream } from '../utils/stream';
import { equalURI } from '../utils/uri-util';

/**
 * Language-specific service for finding references and declaration of a given `CstNode`.
 */
export interface References {

    /**
     * If the CstNode is a reference node the target CstNode will be returned.
     * If the CstNode is a significant node of the CstNode this CstNode will be returned.
     *
     * @param sourceCstNode CstNode that points to a AstNode
     */
    findDeclaration(sourceCstNode: CstNode): AstNode | undefined;

    /**
     * If the CstNode is a reference node the target CstNode will be returned.
     * If the CstNode is a significant node of the CstNode this CstNode will be returned.
     *
     * @param sourceCstNode CstNode that points to a AstNode
     */
    findDeclarationNode(sourceCstNode: CstNode): CstNode | undefined;

    /**
     * Finds all references to the target node as references (local references) or reference descriptions.
     *
     * @param targetNode Specified target node whose references should be returned
     */
    findReferences(targetNode: AstNode, options: FindReferencesOptions): Stream<ReferenceDescription>;
}

export interface FindReferencesOptions {
    /**
     * @deprecated Since v1.2.0. Please use `documentUri` instead.
     */
    onlyLocal?: boolean;
    /**
     * When set, the `findReferences` method will only return references/declarations from the specified document.
     */
    documentUri?: URI;
    /**
     * Whether the returned list of references should include the declaration.
     */
    includeDeclaration?: boolean;
}

export class DefaultReferences implements References {
    protected readonly nameProvider: NameProvider;
    protected readonly index: IndexManager;
    protected readonly nodeLocator: AstNodeLocator;

    constructor(services: LangiumServices) {
        this.nameProvider = services.references.NameProvider;
        this.index = services.shared.workspace.IndexManager;
        this.nodeLocator = services.workspace.AstNodeLocator;
    }

    findDeclaration(sourceCstNode: CstNode): AstNode | undefined {
        if (sourceCstNode) {
            const assignment = findAssignment(sourceCstNode);
            const nodeElem = sourceCstNode.element;
            if (assignment && nodeElem) {
                const reference = (nodeElem as GenericAstNode)[assignment.feature];

                if (isReference(reference)) {
                    return reference.ref;
                } else if (Array.isArray(reference)) {
                    for (const ref of reference) {
                        if (isReference(ref) && ref.$refNode
                            && ref.$refNode.offset <= sourceCstNode.offset
                            && ref.$refNode.end >= sourceCstNode.end) {
                            return ref.ref;
                        }
                    }
                }
            }
            if (nodeElem) {
                const nameNode = this.nameProvider.getNameNode(nodeElem);
                // Only return the targeted node in case the targeted cst node is the name node or part of it
                if (nameNode && (nameNode === sourceCstNode || isCstChildNode(sourceCstNode, nameNode))) {
                    return nodeElem;
                }
            }
        }
        return undefined;
    }

    findDeclarationNode(sourceCstNode: CstNode): CstNode | undefined {
        const astNode = this.findDeclaration(sourceCstNode);
        if (astNode?.$cstNode) {
            const targetNode = this.nameProvider.getNameNode(astNode);
            return targetNode ?? astNode.$cstNode;
        }
        return undefined;
    }

    findReferences(targetNode: AstNode, options: FindReferencesOptions): Stream<ReferenceDescription> {
        const refs: ReferenceDescription[] = [];
        if (options.includeDeclaration) {
            const ref = this.getReferenceToSelf(targetNode);
            if (ref) {
                refs.push(ref);
            }
        }
        let indexReferences = this.index.findAllReferences(targetNode, this.nodeLocator.getAstNodePath(targetNode));
        if (options.documentUri) {
            indexReferences = indexReferences.filter(ref => equalURI(ref.sourceUri, options.documentUri));
        }
        refs.push(...indexReferences);
        return stream(refs);
    }

    protected getReferenceToSelf(targetNode: AstNode): ReferenceDescription | undefined {
        const nameNode = this.nameProvider.getNameNode(targetNode);
        if (nameNode) {
            const doc = getDocument(targetNode);
            const path = this.nodeLocator.getAstNodePath(targetNode);
            return {
                sourceUri: doc.uri,
                sourcePath: path,
                targetUri: doc.uri,
                targetPath: path,
                segment: toDocumentSegment(nameNode),
                local: true
            };
        }
        return undefined;
    }
}

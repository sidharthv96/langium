/******************************************************************************
 * This file was generated by langium-cli 1.0.0.
 * DO NOT EDIT MANUALLY!
 ******************************************************************************/

import { LanguageMetaData } from '../language-meta-data';
import { Module } from '../../dependency-injection';
import { LangiumGeneratedServices, LangiumGeneratedSharedServices, LangiumSharedServices, LangiumServices } from '../../services';
import { IParserConfig } from '../../parser/parser-config';
import { LangiumGrammarAstReflection } from './ast';
import { LangiumGrammarGrammar } from './grammar';

export const LangiumGrammarLanguageMetaData: LanguageMetaData = {
    languageId: 'langium',
    fileExtensions: ['.langium'],
    caseInsensitive: false
};

export const LangiumGrammarParserConfig: IParserConfig = {
    maxLookahead: 3,
};

export const LangiumGrammarGeneratedSharedModule: Module<LangiumSharedServices, LangiumGeneratedSharedServices> = {
    AstReflection: () => new LangiumGrammarAstReflection()
};

export const LangiumGrammarGeneratedModule: Module<LangiumServices, LangiumGeneratedServices> = {
    Grammar: () => LangiumGrammarGrammar(),
    LanguageMetaData: () => LangiumGrammarLanguageMetaData,
    parser: {
        ParserConfig: () => LangiumGrammarParserConfig
    }
};

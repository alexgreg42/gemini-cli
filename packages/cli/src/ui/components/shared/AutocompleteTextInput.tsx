/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box } from 'ink';
import { TextInput, type TextInputProps } from './TextInput.js';
import { useCommandCompletion } from '../../hooks/useCommandCompletion.js';
import { SuggestionsDisplay } from '../SuggestionsDisplay.js';
import { useConfig } from '../../contexts/ConfigContext.js';
import { useKeypress, type Key } from '../../hooks/useKeypress.js';
import { useKeyMatchers } from '../../hooks/useKeyMatchers.js';
import { Command } from '../../key/keyMatchers.js';

export interface AutocompleteTextInputProps extends TextInputProps {
  suggestionsPosition?: 'above' | 'below';
  availableWidth?: number;
}

/**
 * A wrapper around TextInput that provides @-mention autocomplete for files.
 */
export function AutocompleteTextInput(
  props: AutocompleteTextInputProps,
): React.JSX.Element {
  const {
    suggestionsPosition = 'above',
    availableWidth = 80,
    ...textInputProps
  } = props;
  const config = useConfig();
  const keyMatchers = useKeyMatchers();

  const completion = useCommandCompletion({
    buffer: props.buffer,
    cwd: process.cwd(),
    slashCommands: [],
    shellModeActive: false,
    config,
    active: props.focus ?? true,
  });

  const handleKeypress = (key: Key) => {
    if (!completion.showSuggestions) return false;

    if (key.name === 'tab') {
      completion.handleAutocomplete(completion.activeSuggestionIndex);
      return true;
    }
    if (keyMatchers[Command.MOVE_UP](key)) {
      completion.navigateUp();
      return true;
    }
    if (keyMatchers[Command.MOVE_DOWN](key)) {
      completion.navigateDown();
      return true;
    }
    if (keyMatchers[Command.SUBMIT](key) && !completion.isPerfectMatch) {
      completion.handleAutocomplete(completion.activeSuggestionIndex);
      return true;
    }
    return false;
  };

  useKeypress(handleKeypress, {
    isActive: props.focus ?? true,
    priority: true,
  });

  const suggestionsNode = completion.showSuggestions ? (
    <Box paddingRight={2}>
      <SuggestionsDisplay
        suggestions={completion.suggestions}
        activeIndex={completion.activeSuggestionIndex}
        isLoading={completion.isLoadingSuggestions}
        width={availableWidth}
        scrollOffset={completion.visibleStartIndex}
        userInput={props.buffer.text}
        mode={suggestionsPosition === 'above' ? 'reverse' : undefined}
      />
    </Box>
  ) : null;

  return (
    <Box flexDirection="column">
      {suggestionsPosition === 'above' && suggestionsNode}
      <TextInput {...textInputProps} />
      {suggestionsPosition === 'below' && suggestionsNode}
    </Box>
  );
}

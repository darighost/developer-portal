import { ActionModelWithNullifiers } from "@/lib/models";
import { gql } from "@apollo/client";
import { internal as IDKitInternal } from "@worldcoin/idkit";
import { useCallback, useState } from "react";
import { toast } from "react-toastify";
import { graphQLRequest } from "src/lib/frontend-api";
import { IActionStore, useActionStore } from "src/stores/actionStore";
import { IAppStore, useAppStore } from "src/stores/appStore";
import useSWR from "swr";
import useSWRMutation from "swr/mutation";
import { shallow } from "zustand/shallow";

const actionFields = `
  id
  app_id
  action
  created_at
  creation_mode
  description
  external_nullifier
  kiosk_enabled
  name
  max_accounts_per_user
  max_verifications
  updated_at
  nullifiers {
      id
      created_at
      nullifier_hash
      credential_type
  }
`;

const FetchActionsQuery = gql`
  query Actions($app_id: String!) {
    action(order_by: { created_at: asc }, where: { app_id: {_eq: $app_id}, action: { _neq: "" } }) {
      ${actionFields}
    }
  }
`;

const UpdateActionMutation = gql`
  mutation UpdateAction(
    $id: String!
    $name: String!
    $description: String!
    $max_verifications: Int!
    $kiosk_enabled: Boolean!
  ) {
    update_action_by_pk(
      pk_columns: { id: $id }
      _set: {
        name: $name
        description: $description
        max_verifications: $max_verifications
        kiosk_enabled: $kiosk_enabled
      }
    ) {
        ${actionFields}
    }
  }
`;

const InsertActionMutation = gql`
  mutation InsertAction(
    $name: String!
    $description: String = ""
    $action: String = ""
    $app_id: String!,
    $external_nullifier: String!
    $max_verifications: Int = 1
  ) {
    insert_action_one(
      object: {
        action: $action
        app_id: $app_id
        name: $name
        description: $description
        external_nullifier: $external_nullifier
        max_verifications: $max_verifications
      }
    ) {
        ${actionFields}
    }
  }
`;

const fetchActions = async (): Promise<Array<ActionModelWithNullifiers>> => {
  const currentApp = useAppStore.getState().currentApp;

  if (!currentApp) {
    throw new Error("App not found in state");
  }

  const response = await graphQLRequest<{
    action: Array<ActionModelWithNullifiers>;
  }>({
    query: FetchActionsQuery,
    variables: {
      app_id: currentApp.id,
    },
  });

  if (response.data?.action.length) {
    return response.data.action;
  }

  return [];
};

const updateActionFetcher = async (
  _key: [string, string | undefined],
  args: {
    arg: {
      id: ActionModelWithNullifiers["id"];
      name?: ActionModelWithNullifiers["name"];
      description?: ActionModelWithNullifiers["description"];
      max_verifications?: ActionModelWithNullifiers["max_verifications"];
      kiosk_enabled?: ActionModelWithNullifiers["kiosk_enabled"];
    };
  }
) => {
  const { id, name, description, max_verifications, kiosk_enabled } = args.arg;

  const currentAction = useActionStore
    .getState()
    .actions.find((action) => action.id === id);

  if (!currentAction) {
    throw new Error("Action not found in state");
  }

  const response = await graphQLRequest<{
    update_action_by_pk: ActionModelWithNullifiers;
  }>({
    query: UpdateActionMutation,
    variables: {
      id: id,
      name: name ?? currentAction.name,
      description: description ?? currentAction.description,
      max_verifications: max_verifications ?? currentAction.max_verifications,
      kiosk_enabled: kiosk_enabled ?? currentAction.kiosk_enabled,
    },
  });

  if (response.data?.update_action_by_pk) {
    return response.data.update_action_by_pk;
  }

  throw new Error("Failed to update app status");
};

const insertActionFetcher = async (_key: [string, string | undefined]) => {
  const currentApp = useAppStore.getState().currentApp;

  if (!currentApp) {
    throw new Error("App not found in state");
  }

  const { name, description, action, maxVerifications } =
    useActionStore.getState().newAction;

  const external_nullifier = IDKitInternal.generateExternalNullifier(
    currentApp.id,
    action
  ).digest;

  const response = await graphQLRequest<{
    insert_action_one: ActionModelWithNullifiers;
  }>(
    {
      query: InsertActionMutation,
      variables: {
        name,
        description,
        action,
        max_verifications: maxVerifications,
        app_id: currentApp.id,
        external_nullifier,
      },
    },
    true
  );

  if (response.data?.insert_action_one) {
    return response.data.insert_action_one;
  }
};

const getAppStore = (store: IAppStore) => ({
  currentApp: store.currentApp,
});

const getActionsStore = (store: IActionStore) => ({
  actions: store.actions,
  setActions: store.setActions,
  setNewAction: store.setNewAction,
  setNewIsOpened: store.setIsNewActionModalOpened,
});

const useActions = () => {
  const { currentApp } = useAppStore(getAppStore, shallow);

  const { actions, setActions, setNewIsOpened, setNewAction } = useActionStore(
    getActionsStore,
    shallow
  );

  const { data, error, isLoading } = useSWR<Array<ActionModelWithNullifiers>>(
    ["actions", currentApp?.id],
    fetchActions,
    {
      onSuccess: (data) => setActions(data),
    }
  );

  const { trigger: updateAction } = useSWRMutation(
    ["actions", currentApp?.id],
    updateActionFetcher,
    {
      onSuccess: (data) => {
        if (data) {
          const newActions = actions.map((action) =>
            action.id === data.id ? data : action
          );

          setActions(newActions);
        }
      },
    }
  );

  const updateName = useCallback(
    (id: string, name: string) => {
      const currentAction = actions.find((action) => action.id === id);

      if (!currentAction) {
        return;
      }

      updateAction({
        id,
        name,
      });
    },
    [actions, updateAction]
  );

  const updateDescription = useCallback(
    (id: string, description: string) => {
      const currentAction = actions.find((action) => action.id === id);

      if (!currentAction) {
        return;
      }

      updateAction({
        id,
        description,
      });
    },
    [actions, updateAction]
  );

  const updateMaxVerifications = useCallback(
    (id: string, max_verifications: number) => {
      const currentAction = actions.find((action) => action.id === id);

      if (!currentAction) {
        return;
      }

      updateAction({
        id,
        max_verifications,
      });
    },
    [actions, updateAction]
  );

  const toggleKiosk = useCallback(
    (id: string) => {
      const currentAction = actions.find((action) => action.id === id);

      if (!currentAction) {
        return;
      }

      updateAction({
        id,
        kiosk_enabled: !currentAction.kiosk_enabled,
      });
    },
    [actions, updateAction]
  );

  const [isNewActionDuplicateAction, setIsNewActionDuplicateAction] =
    useState(false);

  const { trigger: insertAction, isMutating: isNewActionMutating } =
    useSWRMutation(["actions", currentApp?.id], insertActionFetcher, {
      onSuccess: (data) => {
        if (data) {
          setActions([...actions, data]);
          setNewAction({ name: "", description: "", action: "" });
          setNewIsOpened(false);
          toast.success("Action created");
        }
      },
      onError: (err) => {
        if (
          err.graphQLErrors[0].extensions["code"] === "constraint-violation"
        ) {
          setIsNewActionDuplicateAction(true);
          toast.error(
            'An action with this identifier already exists for this app. Please change the "action" identifier.'
          );
        }
      },
      throwOnError: false,
    });

  const createNewAction = useCallback(() => {
    setIsNewActionDuplicateAction(false);
    insertAction();
  }, [insertAction]);

  return {
    actions: data,
    error,
    isLoading,
    updateAction,
    updateName,
    updateDescription,
    updateMaxVerifications,
    toggleKiosk,
    createNewAction,
    isNewActionMutating,
    isNewActionDuplicateAction,
  };
};

export default useActions;

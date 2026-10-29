using Windows.UI.Xaml;
using Windows.UI.Xaml.Automation.Peers;
using Windows.UI.Xaml.Controls;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// A button that navigates, which the web draws as an anchor: its automation peer reports the Hyperlink control type
    /// (still invokable), so assistive technology and the layout export read the same role the web exposes.
    /// </summary>
    public class LinkButton : Button
    {
        /// <summary>False once the control acts rather than navigates (the web's "Start" button on a series).</summary>
        public bool IsLink { get; set; } = true;

        protected override AutomationPeer OnCreateAutomationPeer() => new LinkButtonPeer(this);
    }

    internal sealed class LinkButtonPeer : ButtonAutomationPeer
    {
        private readonly LinkButton _owner;

        public LinkButtonPeer(LinkButton owner) : base(owner)
        {
            _owner = owner;
        }

        protected override AutomationControlType GetAutomationControlTypeCore() =>
            _owner.IsLink ? AutomationControlType.Hyperlink : base.GetAutomationControlTypeCore();

        protected override string GetClassNameCore() => "Hyperlink";
    }

    /// <summary>A card in a list: the web opens it with an anchor, so the item container reports a Hyperlink.</summary>
    public class LinkListViewItem : ListViewItem
    {
        protected override AutomationPeer OnCreateAutomationPeer() => new LinkListViewItemPeer(this);
    }

    internal sealed class LinkListViewItemPeer : ListViewItemAutomationPeer
    {
        public LinkListViewItemPeer(LinkListViewItem owner) : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Hyperlink;
    }

    /// <summary>A list whose item containers are <see cref="LinkListViewItem"/>.</summary>
    public class LinkListView : ListView
    {
        protected override DependencyObject GetContainerForItemOverride() => new LinkListViewItem();

        protected override bool IsItemItsOwnContainerOverride(object item) => item is LinkListViewItem;
    }

    /// <summary>A card in a grid: the web opens it with an anchor, so the item container reports a Hyperlink.</summary>
    public class LinkGridViewItem : GridViewItem
    {
        protected override AutomationPeer OnCreateAutomationPeer() => new LinkGridViewItemPeer(this);
    }

    internal sealed class LinkGridViewItemPeer : GridViewItemAutomationPeer
    {
        public LinkGridViewItemPeer(LinkGridViewItem owner) : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Hyperlink;
    }

    /// <summary>A grid whose item containers are <see cref="LinkGridViewItem"/>.</summary>
    public class LinkGridView : GridView
    {
        protected override DependencyObject GetContainerForItemOverride() => new LinkGridViewItem();

        protected override bool IsItemItsOwnContainerOverride(object item) => item is LinkGridViewItem;
    }
}

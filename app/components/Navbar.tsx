import { Form, Link } from "react-router";

const Navbar = () => {
    return (
        <nav className="navbar">
            <Link to="/">
                <p className="text-2xl font-bold text-gradient">RESUME.LY</p>
            </Link>
            <div className="flex items-center gap-4">
                <Link to="/upload" className="primary-button w-fit">
                    Upload Resume
                </Link>
                <Form method="post" action="/logout">
                    <button type="submit" className="text-gray-600 font-medium cursor-pointer hover:text-gray-900">
                        Log out
                    </button>
                </Form>
            </div>
        </nav>
    );
};

export default Navbar;
